/**
 * Vimeo Lightbox System
 * Enhanced with timeline controls, pause feedback, and iframe management
 */

// Basic config and debug helpers
let vimeoApiAttempts = 0;
const maxVimeoApiAttempts = 20; // ~2s total
const INIT_RETRY_DELAY_MS = 100;
const DEBUG = false;

// Wait for DOM and Vimeo API to be ready
function initLightbox() {
    // Check if Vimeo Player API is available
    if (typeof Vimeo === 'undefined') {
        if (vimeoApiAttempts < maxVimeoApiAttempts) {
            vimeoApiAttempts++;
            if (DEBUG) console.warn('Vimeo Player API not loaded, retrying...');
            setTimeout(initLightbox, INIT_RETRY_DELAY_MS);
            return;
        } else {
            console.error('Vimeo API failed to load');
            return;
        }
    }
    
    // Check if DOM elements exist
    const lightboxElement = document.getElementById('lightbox');
    if (!lightboxElement) {
        if (DEBUG) console.warn('Lightbox element not found, retrying...');
        setTimeout(initLightbox, INIT_RETRY_DELAY_MS);
        return;
    }
    
    // Utility: check if an element is visible in the document
    function isElementVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
            return false;
        }
        const rect = element.getBoundingClientRect();
        const withinViewport = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= (window.innerHeight || document.documentElement.clientHeight) && rect.left <= (window.innerWidth || document.documentElement.clientWidth);
        return withinViewport;
    }

    // Observe DOM mutations for late-inserted lightbox/tiles
    function observeDOMForLightbox() {
        const observer = new MutationObserver(() => {
            const lightboxExists = document.getElementById('lightbox');
            const thumbnailsExist = document.querySelectorAll('.open-lightbox .video-thumbnail').length > 0;
            const tilesExist = document.querySelectorAll('.open-lightbox .project-data').length > 0;
            if (lightboxExists && (thumbnailsExist || tilesExist)) {
                observer.disconnect();
                initLightbox();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 10000);
    }

    /**
     * Vimeo Lightbox System
     */
    class VimeoLightbox {
        constructor() {
            try {
                // Get main lightbox element
                this.lightbox = document.getElementById('lightbox');
                if (!this.lightbox) {
                    console.error('Lightbox element not found');
                    return;
                }

                // Get all required elements with null checks
                this.videoFrame = document.getElementById('lightbox-iframe');
                this.videoTitle = document.getElementById('video-title');
                this.playBtn = this.lightbox.querySelector('.play-btn');
                this.controlsLeft = this.lightbox.querySelector('.controls-left');
                this.currentTimeEl = this.lightbox.querySelector('.current-time');
                this.totalTimeEl = this.lightbox.querySelector('.total-time');
                this.loading = this.lightbox.querySelector('.loading');
                this.pauseIndicator = this.lightbox.querySelector('.control-indicator');
                this.pauseText = this.lightbox.querySelector('.control-text');
                this.errorPlaceholder = this.lightbox.querySelector('.video-error-placeholder');
                this.controls = this.lightbox.querySelector('.controls');
                this.closeBtn = this.lightbox.querySelector('.lightbox-close');
                this.clickArea = this.lightbox.querySelector('.click-area');
                
                // Timeline elements
                this.timelineContainer = this.lightbox.querySelector('.timeline-container');
                this.timelineTrack = this.lightbox.querySelector('.timeline-track');
                this.timelineProgress = this.lightbox.querySelector('.timeline-progress');
                this.timelineHandle = this.lightbox.querySelector('.timeline-handle');
                this.timelineHoverTime = this.lightbox.querySelector('.timeline-hover-time');
                
                // Log missing elements for debugging
                this.logMissingElements();

                // Validate critical elements
                if (!this.videoFrame || !this.videoTitle || !this.playBtn || !this.closeBtn || !this.controls) {
                    console.error('Missing critical lightbox elements');
                    return;
                }
                
                this.currentPlayer = null;
                this.isPlaying = false;
                this.videoDuration = 0;
                this.isDragging = false;
                this.pauseTimeout = null;
                this.toastLockUntil = 0;
                this.lightboxOpenedAt = 0;
                this.loadingTimeoutId = null;
                this.allowLoader = false;
                this.savedScrollY = 0;
                this.prevScrollBehavior = '';
                this.smoother = null;
                this.hadSmoother = false;
                this.savedSmootherY = 0;
                this.lastUserGestureTs = 0;
                this.autoUnmuteDone = false;
                
                this.setupEventListeners();

                // No mute/unmute button; rely on system volume and play/pause only
                this.isMuted = true;
                this.muteBtn = null;
    
                this.initializeThumbnailIframes();
                
                // Debug after initialization is complete
                if (DEBUG) {
                    setTimeout(() => {
                        this.debugThumbnailVideos();
                    }, 100);
                }

                // Reinitialize thumbnail loop iframes after bfcache restore or when tab becomes visible
                const reinitThumbnails = () => {
                    // Delay slightly to ensure layout sizes are correct
                    setTimeout(() => this.initializeThumbnailIframes(), 50);
                };

                // Handle back/forward cache restores
                window.addEventListener('pageshow', (event) => {
                    try {
                        const navEntries = performance.getEntriesByType('navigation');
                        const isBackForward = Array.isArray(navEntries) && navEntries[0] && navEntries[0].type === 'back_forward';
                        if (event.persisted || isBackForward) {
                            reinitThumbnails();
                        }
                    } catch (_) {
                        if (event.persisted) reinitThumbnails();
                    }
                });

                // When tab/window becomes visible again
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        reinitThumbnails();
                    }
                });
                
                if (DEBUG) console.log('VimeoLightbox initialized');
            } catch (error) {
                console.error('Error initializing VimeoLightbox:', error);
            }
        }

        isAutoplayRestricted() {
            const ua = navigator.userAgent || navigator.vendor || window.opera;
            const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            const isAndroid = /Android/.test(ua);
            const isMobileChrome = /Chrome\/\d+/.test(ua) && /Mobile/.test(ua);
            return isIOS || isAndroid || isMobileChrome;
        }

        destroy() {
            try {
                if (this.currentPlayer) {
                    this.currentPlayer.destroy();
                    this.currentPlayer = null;
                }
            } catch (_) {}
        }

        logMissingElements() {
            const requiredElements = [
                { name: 'videoFrame', element: this.videoFrame },
                { name: 'videoTitle', element: this.videoTitle },
                { name: 'playBtn', element: this.playBtn },
                { name: 'closeBtn', element: this.closeBtn },
                { name: 'controls', element: this.controls }
            ];

            const missingElements = requiredElements.filter(item => !item.element);
            if (missingElements.length > 0) {
                if (DEBUG) console.warn('Missing elements:', missingElements.map(item => item.name));
            }
        }

        setupEventListeners() {
            try {
                // Close lightbox
                if (this.closeBtn) {
                    this.closeBtn.addEventListener('click', () => this.closeLightbox());
                } else {
                    if (DEBUG) console.warn('Close button not found');
                }

                if (this.lightbox) {
                    this.lightbox.addEventListener('click', (e) => {
                        if (e.target === this.lightbox) this.closeLightbox();
                    });
                }

                // Keyboard controls
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && this.lightbox && this.lightbox.classList.contains('active')) {
                        this.closeLightbox();
                    }
                });

                // Play/pause button - rely on the tap to grant audio
                if (this.playBtn) {
                    this.playBtn.addEventListener('click', () => {
                        this.lastUserGestureTs = Date.now();
                        this.togglePlayPause();
                    });
                } else {
                    if (DEBUG) console.warn('Play button not found');
                }

                // Mute/unmute button
                // Mute/unmute button removed

                // Click area for play/pause - play immediately on first tap
                if (this.clickArea) {
                    this.clickArea.addEventListener('click', () => {
                        this.lastUserGestureTs = Date.now();
                        this.togglePlayPause();
                    });
                }

                // Allow clicking the entire project tile to open (works when media wrapper has pointer-events: none)
                const projectTiles = document.querySelectorAll('.open-lightbox .project-data');
                if (DEBUG) console.log(`Found ${projectTiles.length} project tiles`);
                projectTiles.forEach((tile, index) => {
                    const hasVideoId = tile && tile.dataset && tile.dataset.mainVideo;
                    if (!hasVideoId) return;
                    tile.addEventListener('click', (e) => {
                        if (e && e.preventDefault) e.preventDefault();
                        if (e && e.stopPropagation) e.stopPropagation();
                        const thumbnail = tile.querySelector('.video-thumbnail') || tile;
                        if (DEBUG) console.log(`Project tile ${index + 1} clicked`);
                        this.openLightbox(thumbnail);
                    });
                });
                

                // Timeline interactions
                this.setupTimelineEvents();
                
                // Window resize handler for thumbnails (hide static image on mobile when resizing)
                window.addEventListener('resize', () => this.handleMobileImageVisibility());
                
                if (DEBUG) console.log('Event listeners set up');
            } catch (error) {
                console.error('Error setting up event listeners:', error);
            }
        }

        setupTimelineEvents() {
            if (!this.timelineContainer) {
                if (DEBUG) console.warn('Timeline container not found, skipping timeline events');
                return;
            }

            if (!this.timelineHandle) {
                if (DEBUG) console.warn('Timeline handle not found, skipping drag events');
                return;
            }

            try {
                // Timeline click to seek (no duplicate after drag)
                this.timelineContainer.addEventListener('click', (e) => {
                    if (this.isDragging) return;
                    this.handleTimelineClick(e);
                });

                // Timeline hover for preview
                this.timelineContainer.addEventListener('mousemove', (e) => {
                    this.handleTimelineHover(e);
                });

                this.timelineContainer.addEventListener('mouseleave', () => {
                    if (this.timelineHoverTime) {
                        this.timelineHoverTime.style.opacity = '0';
                    }
                });

                // Timeline drag functionality: allow dragging from the whole container
                const startDrag = (point) => {
                    this.startDragging(point);
                    this.handleTimelineDrag(point);
                };

                this.timelineHandle.addEventListener('mousedown', (e) => {
                    startDrag(e);
                });
                this.timelineContainer.addEventListener('mousedown', (e) => {
                    startDrag(e);
                });

                document.addEventListener('mousemove', (e) => {
                    if (this.isDragging) {
                        this.handleTimelineDrag(e);
                    }
                });

                document.addEventListener('mouseup', () => {
                    if (this.isDragging) {
                        this.stopDragging();
                    }
                });

                // Touch support for mobile
                this.timelineHandle.addEventListener('touchstart', (e) => {
                    startDrag(e.touches[0]);
                    e.preventDefault();
                });
                this.timelineContainer.addEventListener('touchstart', (e) => {
                    startDrag(e.touches[0]);
                    e.preventDefault();
                });

                document.addEventListener('touchmove', (e) => {
                    if (this.isDragging) {
                        this.handleTimelineDrag(e.touches[0]);
                        e.preventDefault();
                    }
                });

                document.addEventListener('touchend', () => {
                    if (this.isDragging) {
                        this.stopDragging();
                    }
                });

                if (DEBUG) console.log('Timeline events set up');
            } catch (error) {
                console.error('Error setting up timeline events:', error);
            }
        }

        handleTimelineClick(e) {
            if (!this.currentPlayer || this.videoDuration === 0) return;

            const rect = this.timelineTrack.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = Math.max(0, Math.min(1, clickX / rect.width));
            const seekTime = percentage * this.videoDuration;

            this.currentPlayer.setCurrentTime(seekTime);
            this.updateTimelinePosition(percentage);
        }

        handleTimelineHover(e) {
            if (!this.timelineContainer || this.videoDuration === 0) return;

            const rect = this.timelineTrack.getBoundingClientRect();
            const hoverX = e.clientX - rect.left;
            const percentage = Math.max(0, Math.min(1, hoverX / rect.width));
            const hoverTime = percentage * this.videoDuration;

            // Update hover time display
            this.timelineHoverTime.textContent = this.formatTime(hoverTime);
            
            // Position hover time indicator
            const containerRect = this.timelineContainer.getBoundingClientRect();
            const relativeX = e.clientX - containerRect.left;
            this.timelineHoverTime.style.left = `${relativeX}px`;
            this.timelineHoverTime.style.opacity = '1';
        }

        startDragging(e) {
            this.isDragging = true;
            document.body.style.cursor = 'grabbing';
            e.preventDefault();
            // Show hover time while scrubbing (works even without CSS :hover)
            if (this.timelineHoverTime) {
                this.timelineHoverTime.style.visibility = 'visible';
                this.timelineHoverTime.style.opacity = '1';
            }
        }

        handleTimelineDrag(e) {
            if (!this.currentPlayer || this.videoDuration === 0) return;

            const rect = this.timelineTrack.getBoundingClientRect();
            const dragX = e.clientX - rect.left;
            const percentage = Math.max(0, Math.min(1, dragX / rect.width));
            const seekTime = percentage * this.videoDuration;

            // Seek continuously while dragging for scrubbing
            this.currentPlayer.setCurrentTime(seekTime);
            this.updateTimelinePosition(percentage);

            // Update hover time position and label while scrubbing
            if (this.timelineHoverTime && this.timelineContainer) {
                const containerRect = this.timelineContainer.getBoundingClientRect();
                const relativeX = e.clientX - containerRect.left;
                this.timelineHoverTime.textContent = this.formatTime(seekTime);
                this.timelineHoverTime.style.left = `${relativeX}px`;
                this.timelineHoverTime.style.visibility = 'visible';
                this.timelineHoverTime.style.opacity = '1';
            }
        }

        stopDragging() {
            this.isDragging = false;
            document.body.style.cursor = '';
            // Hide hover time after scrubbing ends
            if (this.timelineHoverTime) {
                this.timelineHoverTime.style.opacity = '0';
                this.timelineHoverTime.style.visibility = 'hidden';
            }
        }

        updateTimelinePosition(percentage) {
            const percentageStr = `${percentage * 100}%`;
            this.timelineProgress.style.width = percentageStr;
            this.timelineHandle.style.left = percentageStr;
        }



        initializeThumbnailIframes() {
            if (DEBUG) console.log('Initializing thumbnail iframes');
            
            // Initialize iframes for all thumbnails (only called once)
            const thumbnails = document.querySelectorAll('.open-lightbox .video-thumbnail');
            thumbnails.forEach(thumbnail => {
                const projectData = thumbnail.closest('.project-data');
                const mainVimeoId = projectData ? projectData.dataset.mainVideo : undefined;
                const thumbnailId = projectData ? projectData.dataset.thumbnailId : undefined;
                
                if (DEBUG) console.log(`Initializing thumbnail with main ID: ${mainVimeoId}, thumbnail ID: ${thumbnailId}`);
                
                // Remove any existing iframes first
                const existingIframes = thumbnail.querySelectorAll('iframe');
                existingIframes.forEach(iframe => iframe.remove());
                
                // Defer iframe creation until thumbnail has layout size (no hard-coded sizing)
                const hasSize = thumbnail.offsetWidth > 0 && thumbnail.offsetHeight > 0;
                if (!hasSize) {
                    if (DEBUG) console.log('Thumbnail has no size yet, deferring iframe creation');
                    const startWhenSized = () => this.createLoopVideoIframe(thumbnail, thumbnailId);
                    if (typeof ResizeObserver !== 'undefined') {
                        const ro = new ResizeObserver(() => {
                            if (thumbnail.offsetWidth > 0 && thumbnail.offsetHeight > 0) {
                                ro.disconnect();
                                startWhenSized();
                            }
                        });
                        ro.observe(thumbnail);
                    } else {
                        const pollId = setInterval(() => {
                            if (thumbnail.offsetWidth > 0 && thumbnail.offsetHeight > 0) {
                                clearInterval(pollId);
                                startWhenSized();
                            }
                        }, 100);
                        setTimeout(() => clearInterval(pollId), 10000);
                    }
                } else {
                    this.createLoopVideoIframe(thumbnail, thumbnailId);
                }
            });
        }

        recreateIframe() {
            if (DEBUG) console.log('Recreating iframe element');
            
            // Get the parent container
            const videoPlayer = this.lightbox.querySelector('.custom-video-player');
            
            // Remove the old iframe
            if (this.videoFrame) {
                this.videoFrame.remove();
            }
            
            // Create a new iframe
            const newIframe = document.createElement('iframe');
            newIframe.className = 'video-frame';
            newIframe.id = 'lightbox-iframe';
            newIframe.src = '';
            newIframe.frameBorder = '0';
            newIframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
            newIframe.setAttribute('playsinline', '1');
            
            // Insert it as the first child of the video player
            videoPlayer.insertBefore(newIframe, videoPlayer.firstChild);
            
            // Update our references
            this.videoFrame = newIframe;
            this.pauseIndicator = this.lightbox.querySelector('.control-indicator');
            this.controls = this.lightbox.querySelector('.controls');
            
            // Update timeline references
            this.timelineContainer = this.lightbox.querySelector('.timeline-container');
            this.timelineTrack = this.lightbox.querySelector('.timeline-track');
            this.timelineProgress = this.lightbox.querySelector('.timeline-progress');
            this.timelineHandle = this.lightbox.querySelector('.timeline-handle');
            this.timelineHoverTime = this.lightbox.querySelector('.timeline-hover-time');
            
            if (DEBUG) console.log('New iframe created');
            // Ensure iframe is visible by default
            if (this.videoFrame) {
                this.videoFrame.style.opacity = '1';
            }
        }

        createLoopVideoIframe(thumbnail, thumbnailId) {
            if (DEBUG) console.log(`Creating loop video iframe for: ${thumbnailId}`);
            
            // Skip invalid thumbnail IDs
            if (!thumbnailId || thumbnailId === 'INVALID_ID_FOR_TESTING' || thumbnailId === 'undefined') {
                if (DEBUG) console.log('Skipping invalid thumbnail ID');
                return;
            }
            
            // Create iframe with loop video
            const iframe = document.createElement('iframe');
            iframe.src = `https://player.vimeo.com/video/${thumbnailId}?background=1&autoplay=1&loop=1&muted=1&controls=0&title=0&byline=0&portrait=0&playsinline=1`;
            iframe.frameBorder = '0';
            iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
            iframe.setAttribute('playsinline', '1');
            iframe.allowFullscreen = true;
            iframe.setAttribute('data-vimeo-background', 'true');
            
            // Set positioning styles
            iframe.style.position = 'absolute';
            iframe.style.top = '-1%';
            iframe.style.left = '-1%';
            iframe.style.width = '102%';
            iframe.style.height = '102%';
            iframe.style.objectFit = 'cover';
            iframe.style.transition = 'opacity 0.3s ease';
            iframe.style.pointerEvents = 'none';
            iframe.style.borderRadius = '8px';
            iframe.style.zIndex = '2';
            
            // Handle iframe load errors (403, 404, etc.)
            iframe.addEventListener('error', () => {
                if (DEBUG) console.warn(`Failed to load thumbnail video: ${thumbnailId}`);
                thumbnail.classList.add('video-failed');
            });
            
            // Set a timeout to detect failed videos (403, private videos, etc.)
            const errorTimeout = setTimeout(() => {
                if (!isElementVisible(thumbnail)) return; // skip while hidden
                if (!thumbnail.classList.contains('video-failed')) {
                    if (DEBUG) console.warn(`Thumbnail video timeout: ${thumbnailId}`);
                    thumbnail.classList.add('video-failed');
                }
            }, 5000);
            
            // Also handle load event to detect successful loading
            iframe.addEventListener('load', () => {
                // Clear the timeout since iframe loaded
                clearTimeout(errorTimeout);
                
                // Additional check for error pages or empty content
                setTimeout(() => {
                    if (!isElementVisible(thumbnail)) return; // skip while hidden
                    if (iframe.offsetHeight === 0 || iframe.offsetWidth === 0) {
                        if (DEBUG) console.warn(`Thumbnail video has no dimensions: ${thumbnailId}`);
                        thumbnail.classList.add('video-failed');
                    } else {
                        if (DEBUG) console.log(`Thumbnail video loaded: ${thumbnailId}`);
                        
                        // Hide static image on mobile after video loads
                        this.hideStaticImageOnMobile(thumbnail);
                    }
                }, 1000);
            });
            
            // Add to thumbnail (after the img element)
            const img = thumbnail.querySelector('img');
            if (img) {
                img.insertAdjacentElement('afterend', iframe);
            } else {
                thumbnail.appendChild(iframe);
            }
            
            if (DEBUG) console.log(`Loop video iframe created: ${iframe.src}`);
        }

        hideStaticImageOnMobile(thumbnail) {
            // Check if we're on mobile (screen width <= 768px)
            const isMobile = window.innerWidth <= 768;

            // Find sibling cover image within the same project tile
            const thumbContainer = thumbnail.closest('.project-data') || thumbnail.parentElement;
            const cover = thumbContainer ? thumbContainer.querySelector('.project-cover-img') : null;

            // The loop iframe lives inside the thumbnail
            const iframe = thumbnail.querySelector('iframe');

            if (isMobile) {
                // Only hide if iframe exists and has loaded successfully
                if (cover && iframe && iframe.offsetHeight > 0) {
                    if (DEBUG) console.log('Mobile detected - hiding static cover image');
                    cover.style.opacity = '0';
                    cover.style.visibility = 'hidden';
                }
            } else {
                // On desktop, ensure image is visible
                if (cover) {
                    cover.style.opacity = '';
                    cover.style.visibility = '';
                }
            }
        }

        handleMobileImageVisibility() {
            // Check all thumbnails when window is resized
            const thumbnails = document.querySelectorAll('.open-lightbox .video-thumbnail');
            thumbnails.forEach(thumbnail => {
                this.hideStaticImageOnMobile(thumbnail);
            });
        }

        debugThumbnailVideos() {
            if (DEBUG) console.log('Debugging thumbnail videos');
            
            const thumbnails = document.querySelectorAll('.open-lightbox .video-thumbnail');
            thumbnails.forEach((thumbnail, index) => {
                const projectData = thumbnail.closest('.project-data');
                const title = projectData ? projectData.dataset.title : '';
                const mainVideoId = projectData ? projectData.dataset.mainVideo : '';
                const loopVideoId = projectData ? projectData.dataset.thumbnailId : '';
                const iframe = thumbnail.querySelector('iframe');
                
                if (DEBUG) {
                    console.log(`Thumbnail ${index + 1}: ${title}`);
                    console.log(`Main video ID: ${mainVideoId}`);
                    console.log(`Loop video ID: ${loopVideoId}`);
                }
                
                if (iframe) {
                    if (DEBUG) {
                        console.log(`Iframe src: ${iframe.src}`);
                        console.log(`Iframe opacity: ${getComputedStyle(iframe).opacity}`);
                        console.log(`Iframe dimensions: ${iframe.offsetWidth}x${iframe.offsetHeight}`);
                    }
                    
                    // Check if iframe is showing the correct loop video
                    if (iframe.src.includes(loopVideoId)) {
                        if (DEBUG) console.log(`Iframe shows correct loop video`);
                    } else {
                        if (DEBUG) console.log(`Iframe shows wrong video`);
                    }
                } else {
                    if (DEBUG) console.log(`No iframe found for: ${title}`);
                }
            });
        }

        openLightbox(thumbnail) {
            const projectData = thumbnail.closest('.project-data');
            const vimeoId = projectData ? projectData.dataset.mainVideo : undefined;
            const thumbnailId = projectData ? projectData.dataset.thumbnailId : undefined;
            const title = projectData ? projectData.dataset.title : '';
            
            if (DEBUG) {
                console.log(`Opening lightbox for: ${title}`);
                console.log(`Main video ID: ${vimeoId}`);
                console.log(`Thumbnail ID: ${thumbnailId}`);
            }
            
            // Update title
            this.videoTitle.textContent = title;
            
            // Mark gesture timestamp as early as possible to maximize the mobile gesture window
            this.lightboxOpenedAt = performance.now ? performance.now() : Date.now();

            // Show lightbox
            this.lightbox.classList.add('active');
            // Prefer GSAP ScrollSmoother lock if present; else fall back to HTML fixed lock
            try {
                const smoother = (window.ScrollSmoother && typeof window.ScrollSmoother.get === 'function')
                    ? window.ScrollSmoother.get()
                    : (window.smoother || window.SMOOTHER || null);
                if (smoother) {
                    this.smoother = smoother;
                    this.hadSmoother = true;
                    try { this.savedSmootherY = typeof smoother.scrollTop === 'function' ? smoother.scrollTop() : 0; } catch (_) { this.savedSmootherY = 0; }
                    // Kill any active scrollTo/scroll tweens to prevent a residual smooth scroll frame
                    try {
                        if (window.gsap && typeof window.gsap.killTweensOf === 'function') {
                            const targets = [window, document.documentElement, document.body];
                            try {
                                const contentEl = typeof smoother.content === 'function' ? smoother.content() : null;
                                if (contentEl) targets.push(contentEl);
                            } catch (_) {}
                            window.gsap.killTweensOf(targets);
                        }
                    } catch (_) {}
                    try { smoother.paused(true); } catch (_) {}
                    document.documentElement.classList.add('lightbox-active');
                    document.body.classList.add('lightbox-active');
                    document.body.style.overflow = 'hidden';
                } else {
                    // Lock page scroll without jump (preserve current position)
                    this.savedScrollY = window.scrollY || window.pageYOffset || 0;
                    this.prevScrollBehavior = document.documentElement.style.scrollBehavior || '';
                    document.documentElement.style.scrollBehavior = 'auto';
                    document.documentElement.style.top = `-${this.savedScrollY}px`;
                    document.documentElement.style.position = 'fixed';
                    document.documentElement.style.width = '100%';
                    document.documentElement.classList.add('lightbox-active');
                    document.body.style.overflow = 'hidden';
                    document.body.classList.add('lightbox-active');
                }
            } catch (_) {
                // Fallback to HTML fixed lock on any error
                this.savedScrollY = window.scrollY || window.pageYOffset || 0;
                this.prevScrollBehavior = document.documentElement.style.scrollBehavior || '';
                document.documentElement.style.scrollBehavior = 'auto';
                document.documentElement.style.top = `-${this.savedScrollY}px`;
                document.documentElement.style.position = 'fixed';
                document.documentElement.style.width = '100%';
                document.documentElement.classList.add('lightbox-active');
                document.body.style.overflow = 'hidden';
                document.body.classList.add('lightbox-active');
            }
            
            // Load video (this should use the MAIN video ID, not the thumbnail ID)
            // Assume valid data per site contract; always try to load
            const shouldAutoplayDesktop = !this.isAutoplayRestricted();
            this.loadVideo(vimeoId, { shouldAutoplayDesktop });
        }

                    closeLightbox() {
                            if (DEBUG) console.log('Closing lightbox');
            this.lightbox.classList.remove('active');
            // Unlock page scroll
            if (this.hadSmoother && this.smoother) {
                // Remove lock classes first
                document.documentElement.classList.remove('lightbox-active');
                document.body.classList.remove('lightbox-active');
                document.body.style.overflow = '';
                try {
                    // Restore position instantly, then resume smoothing
                    if (typeof this.smoother.scrollTo === 'function') {
                        this.smoother.scrollTo(this.savedSmootherY, false);
                    } else if (typeof this.smoother.scrollTop === 'function') {
                        this.smoother.scrollTop(this.savedSmootherY);
                    }
                    this.smoother.paused(false);
                } catch (_) {}
                this.hadSmoother = false;
                this.smoother = null;
            } else {
                // Restore position for native scroll lock
                const topStr = document.documentElement.style.top;
                document.documentElement.style.position = '';
                document.documentElement.style.top = '';
                document.documentElement.style.width = '';
                document.documentElement.classList.remove('lightbox-active');
                document.body.style.overflow = '';
                document.body.classList.remove('lightbox-active');
                // Restore scroll position without smooth animation
                const targetY = topStr ? Math.abs(parseInt(topStr, 10)) : (this.savedScrollY || 0);
                document.documentElement.style.scrollBehavior = 'auto';
                window.scrollTo(0, targetY);
                // Restore original scroll-behavior inline style if any
                document.documentElement.style.scrollBehavior = this.prevScrollBehavior || '';
            }
            
            // Clean up player
            if (this.currentPlayer) {
                if (DEBUG) console.log('Destroying current player');
                this.currentPlayer.destroy();
                this.currentPlayer = null;
            }
            
            // Reset UI
            if (DEBUG) console.log('Recreating iframe element');
            this.recreateIframe();
            this.resetControls();
            this.hideError();
            this.hideLoading();
            
            // Refresh thumbnail loop iframes after closing to ensure autoplay resumes
            setTimeout(() => {
                try {
                    this.initializeThumbnailIframes();
                } catch (e) {
                    console.warn('⚠️ Could not reinitialize thumbnail iframes after close:', e);
                }
            }, 50);
        }

        loadVideo(vimeoId, opts = {}) {
            const { shouldAutoplayDesktop = false } = opts;
            if (DEBUG) console.log(`Loading video: ${vimeoId}`);
            // Allow loader only for initial load before player is ready
            this.allowLoader = true;
            this.showLoading();
            this.hideError();
            this.hideControls(); // Hide controls initially until video is ready
            // Ensure iframe is visible; do not delay visibility to avoid long black frames
            if (this.videoFrame) {
                this.videoFrame.style.opacity = '1';
            }
            
            // Check for invalid video ID
            if (vimeoId === 'INVALID_VIDEO_ID_FOR_TESTING') {
                this.showError();
                return;
            }
            
            // Verify iframe exists and is ready
            if (!this.videoFrame) {
                console.error('No iframe found');
                this.showError();
                return;
            }
            
            // Set the iframe src with the full video ID
            // Desktop: normal embed (no background)
            // Mobile: background=1 to ensure inline rendering; rely on user tap to start
            const restricted = this.isAutoplayRestricted();
            const embedUrl = restricted
                ? `https://player.vimeo.com/video/${vimeoId}?background=1&autoplay=0&muted=0&controls=0&dnt=1&transparent=0&playsinline=1`
                : `https://player.vimeo.com/video/${vimeoId}?autoplay=0&muted=0&controls=0&dnt=1&transparent=0&playsinline=1`;
            if (DEBUG) console.log(`Setting iframe src: ${embedUrl}`);
            this.videoFrame.src = embedUrl;
            
            // Initialize Vimeo player immediately
            try {
                if (DEBUG) console.log('Creating new Vimeo player');
                this.currentPlayer = new Vimeo.Player(this.videoFrame);
                // Ensure iframe allows autoplay inline
                try { this.videoFrame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media'); } catch (_) {}
                try { this.videoFrame.setAttribute('playsinline', '1'); } catch (_) {}

                // Desktop: auto-play immediately within the same open click
                if (shouldAutoplayDesktop) {
                    try {
                        this.currentPlayer.setMuted(false).catch(()=>{});
                        this.currentPlayer.setVolume(1).catch(()=>{});
                        this.currentPlayer.play().catch(()=>{});
                    } catch (_) {}
                }

                // Setup player events
                this.currentPlayer.ready().then(() => {
                    if (DEBUG) console.log('Player ready');
                    this.allowLoader = false;
                    this.hideLoading();
                    this.setupPlayerEvents();
                    // Ensure iframe is visible on ready as a safeguard
                    if (this.videoFrame) {
                        this.videoFrame.style.opacity = '1';
                    }
                    // Ensure default volume; do not force muted state
                    try {
                        this.currentPlayer.setVolume(1).catch(() => {});
                    } catch (_) {}
                    // Mobile: hint user to tap for audio
                    try {
                        if (this.isAutoplayRestricted()) {
                            this.showCenterToast('Tap to unmute', 1500);
                        }
                    } catch (_) {}
                    // No auto-play here; rely on user tap
                }).catch(error => {
                    console.error('Error loading video:', error);
                    this.showError();
                });

                // Show controls promptly; no auto-play pre-gesture
                setTimeout(() => { this.showControls(); }, 300);
            } catch (error) {
                console.error('Error creating player:', error);
                this.showError();
            }
        }

        // Removed sound gate overlay; audio is controlled only by the mute button on restricted devices

        setupPlayerEvents() {
            if (!this.currentPlayer) return;
            
            // Video is ready and working, show controls
            this.showControls();
            
            this.currentPlayer.on('play', () => {
                this.isPlaying = true;
                this.playBtn.textContent = 'Pause';
                this.hidePauseIndicator();
                this.hideLoading();
            });
            
            this.currentPlayer.on('pause', () => {
                this.isPlaying = false;
                this.playBtn.textContent = 'Play';
                this.showPauseIndicator();
            });
            
            // Keep mute state in sync and update label
            try {
                this.currentPlayer.on('volumechange', (data) => {
                    try {
                        const volume = typeof data === 'object' && data && typeof data.volume === 'number' ? data.volume : null;
                        if (volume !== null) {
                            this.isMuted = volume === 0;
                            this.updateMuteButtonLabel();
                        }
                    } catch (_) {}
                });
            } catch (_) {}

            this.currentPlayer.on('timeupdate', (data) => {
                const current = this.formatTime(data.seconds);
                this.currentTimeEl.textContent = current;
                
                // Update timeline position if not dragging
                if (!this.isDragging && this.videoDuration > 0) {
                    const percentage = data.seconds / this.videoDuration;
                    this.updateTimelinePosition(percentage);
                }
            });
            
            this.currentPlayer.getDuration().then(duration => {
                this.videoDuration = duration;
                const total = this.formatTime(duration);
                this.totalTimeEl.textContent = total;
            });
            
            // Do not show our loader on buffering to avoid duplicate with Vimeo's internal spinner

            // Do not auto-replay on end (no looping for full lightbox video)
        }

        togglePlayPause() {
            if (!this.currentPlayer) return;
            
            if (this.isPlaying) {
                // On mobile: if playing but muted, treat tap as unmute instead of pause
                if (this.isAutoplayRestricted() && this.isMuted) {
                    Promise.resolve()
                        .then(() => { try { return this.currentPlayer.setMuted(false); } catch (_) {} })
                        .then(() => { try { return this.currentPlayer.setVolume(1); } catch (_) {} })
                        .then(() => { this.isMuted = false; this.updateMuteButtonLabel(); this.hideCenterToast(); })
                        .catch(()=>{});
                } else {
                    this.currentPlayer.pause();
                }
            } else {
                const restricted = this.isAutoplayRestricted();
                if (restricted && this.isMuted) {
                    Promise.resolve()
                        .then(() => { try { return this.currentPlayer.setMuted(false); } catch (_) {} })
                        .then(() => { try { return this.currentPlayer.setVolume(1); } catch (_) {} })
                        .then(() => { try { return this.currentPlayer.play(); } catch (_) {} })
                        .then(() => { this.isMuted = false; this.updateMuteButtonLabel(); this.hideCenterToast(); })
                        .catch(() => { try { this.currentPlayer.play(); } catch (_) {} });
                } else {
                    this.currentPlayer.play().catch(() => {});
                }
            }
        }

        formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        showLoading() {
            // Only show our loader before the player is ready; never during buffering
            if (!this.loading || !this.allowLoader) return;
            if (this.loadingTimeoutId) return; // already scheduled
            this.loadingTimeoutId = setTimeout(() => {
                this.loadingTimeoutId = null;
                if (this.allowLoader) {
                    this.loading.classList.add('active');
                }
            }, 600);
        }

        hideLoading() {
            if (!this.loading) return;
            if (this.loadingTimeoutId) {
                clearTimeout(this.loadingTimeoutId);
                this.loadingTimeoutId = null;
            }
            this.loading.classList.remove('active');
        }

        showPauseIndicator() {
            if (!this.pauseIndicator) return;
            
            // Clear any existing timeout
            if (this.pauseTimeout) {
                clearTimeout(this.pauseTimeout);
                this.pauseTimeout = null;
            }
            
            this.showCenterToast('Paused');
        }

        hidePauseIndicator() {
            this.hideCenterToast();
        }

        showCenterToast(message, durationMs = 1000) {
            if (!this.pauseIndicator) return;
            // Clear any existing timeout
            if (this.pauseTimeout) {
                clearTimeout(this.pauseTimeout);
                this.pauseTimeout = null;
            }
            if (this.pauseText && typeof message === 'string') {
                this.pauseText.textContent = message;
            }
            this.pauseIndicator.classList.add('active');
            // Force visibility to avoid any CSS specificity issues
            this.pauseIndicator.style.opacity = '1';
            this.pauseIndicator.style.visibility = 'visible';
            // Lock hides until after the toast duration
            this.toastLockUntil = Date.now() + durationMs;
            this.pauseTimeout = setTimeout(() => {
                this.hideCenterToast();
            }, durationMs);
        }

        hideCenterToast() {
            if (!this.pauseIndicator) return;
            // Respect lock window
            if (this.toastLockUntil && Date.now() < this.toastLockUntil) {
                return;
            }
            if (this.pauseTimeout) {
                clearTimeout(this.pauseTimeout);
                this.pauseTimeout = null;
            }
            this.pauseIndicator.classList.remove('active');
            this.pauseIndicator.style.opacity = '';
            this.pauseIndicator.style.visibility = '';
            this.toastLockUntil = 0;
        }

        showError() {
            this.hideLoading();
            if (this.errorPlaceholder) {
                this.errorPlaceholder.classList.add('active');
            }
            this.hideControls();
        }

        hideError() {
            if (this.errorPlaceholder) {
                this.errorPlaceholder.classList.remove('active');
            }
            this.showControls();
        }

        hideControls() {
            if (this.controls) {
                this.controls.style.display = 'none';
            }
        }

        showControls() {
            if (this.controls) {
                this.controls.style.display = '';
            }
        }

        resetControls() {
            if (this.playBtn) {
                this.playBtn.textContent = 'Play';
            }
            // Reset mute to default muted state and button label
            this.isMuted = true;
            this.updateMuteButtonLabel();
            if (this.currentTimeEl) {
                this.currentTimeEl.textContent = '0:00';
            }
            if (this.totalTimeEl) {
                this.totalTimeEl.textContent = '0:00';
            }
            
            this.isPlaying = false;
            this.videoDuration = 0;
            this.isDragging = false;
            this.pauseTimeout = null;
            this.hidePauseIndicator();
            this.showControls();
            
            // Reset timeline position
            this.updateTimelinePosition(0);
        }

        updateMuteButtonLabel() {
            if (!this.muteBtn) return;
            // Show text label; aria-label mirrors text
            this.muteBtn.textContent = this.isMuted ? 'Unmute' : 'Mute';
            this.muteBtn.setAttribute('aria-label', this.isMuted ? 'Unmute' : 'Mute');
        }
    }

    // Initialize the lightbox system
    new VimeoLightbox();
    if (DEBUG) console.log('Vimeo Lightbox system initialized');
}

// Auto-initialize when DOM is ready with retries for Webflow
let initAttempts = 0;
const maxAttempts = 10;

function tryInitLightbox() {
    initAttempts++;
    if (DEBUG) console.log(`Lightbox initialization attempt ${initAttempts}/${maxAttempts}`);
    
    // Check if basic elements exist
    const lightboxExists = document.getElementById('lightbox');
    const thumbnailsExist = document.querySelectorAll('.open-lightbox .video-thumbnail').length > 0;
    const tilesExist = document.querySelectorAll('.open-lightbox .project-data').length > 0;
    
    if (lightboxExists && (thumbnailsExist || tilesExist)) {
        if (DEBUG) console.log('Required elements found, initializing lightbox');
        initLightbox();
    } else {
        if (DEBUG) console.warn(`Missing elements - lightbox: ${!!lightboxExists}, thumbnails: ${thumbnailsExist}, tiles: ${tilesExist}`);
        
        if (initAttempts < maxAttempts) {
            if (DEBUG) console.log(`Retrying in 500ms... (attempt ${initAttempts + 1}/${maxAttempts})`);
            setTimeout(tryInitLightbox, 500);
        } else {
            console.error('Failed to initialize lightbox. Check HTML structure.');
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInitLightbox);
} else {
    // DOM already loaded, start trying immediately
    tryInitLightbox();
} 