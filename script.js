// 立即执行的函数表达式 (IIFE)，创建独立作用域
(function() {
    'use strict'; // 启用严格模式

    // --- 常量定义 ---
    const TONEARM_ANGLES = { RESTING: 70, START: 100 }; // 唱臂角度: 静止, 播放开始
    const TONEARM_DRAG_LIMITS = { MIN: 65, MAX: 110 }; // 唱臂拖动限制
    const TONEARM_DRAG_THROTTLE_MS = 50; // 唱臂拖动节流时间 (ms), ~20fps
    const PROGRESS_DRAG_THROTTLE_MS = 30; // 进度条拖动节流时间 (ms), ~33fps

    // --- DOM 元素缓存 ---
    function getElements() {
        // (代码同前一个版本，此处省略)
        const elements = {
            playerSection: document.getElementById('player-section'),
            audioPlayer: document.getElementById('audio-player'),
            playerWrapper: document.getElementById('player-wrapper'),
            record: document.getElementById('record'),
            albumArt: document.getElementById('album-art'),
            tonearmBase: document.getElementById('tonearm-base'),
            tonearmRotator: document.getElementById('tonearm-rotator'),
            tonearmBar: document.querySelector('.tonearm-bar'),
            loadingIndicator: document.querySelector('.loading-indicator'),
            errorMessage: document.getElementById('error-message'),
            songTitle: document.getElementById('song-title'),
            songArtist: document.getElementById('song-artist'),
            progressContainer: document.getElementById('progress-container'),
            progressBar: document.getElementById('progress-bar'),
            currentTimeDisplay: document.getElementById('current-time'),
            durationDisplay: document.getElementById('duration'),
            playPauseButton: document.getElementById('play-pause-button'),
            playIcon: document.querySelector('#play-pause-button svg.icon-play'),
            pauseIcon: document.querySelector('#play-pause-button svg.icon-pause'),
            prevButton: document.getElementById('prev-button'),
            nextButton: document.getElementById('next-button'),
            addLocalButton: document.getElementById('add-local-button'),
            localFileInput: document.getElementById('local-file-input'),
            poemTitle: document.getElementById('poem-title'),
            poemAuthor: document.getElementById('poem-author'),
            poemContent: document.getElementById('poem-content'),
            poemDate: document.getElementById('poem-date'),
            poemLocation: document.getElementById('poem-location'),
            poemMetaDivider: document.getElementById('meta-divider'),
            poemTags: document.getElementById('poem-tags')
        };

        let allFound = true;
        const criticalElements = [
            'playerSection', 'audioPlayer', 'playerWrapper', 'playPauseButton',
            'playIcon', 'pauseIcon', 'record', 'albumArt', 'progressContainer',
            'progressBar', 'songTitle', 'songArtist', 'errorMessage',
            'tonearmBase', 'tonearmRotator', 'tonearmBar'
        ];
        for (const key in elements) {
            if (elements[key] === null) {
                // console.error(`错误：未能找到元素 "${key}"。请检查 HTML 中的 ID 或选择器是否正确。`); // Removed log
                if (criticalElements.includes(key)) {
                    allFound = false;
                }
            }
        }

        if (!allFound) {
            // console.error("部分关键 DOM 元素缺失，播放器可能无法正常工作！"); // Removed log
        }

        return { elements, allFound };
    }

    // --- 工具函数 ---
    const utils = {
      formatTime: (seconds) => {
        const time = Math.max(0, seconds || 0);
        const minutes = Math.floor(time / 60);
        const secs = Math.floor(time % 60);
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
      },
      throttle: (func, limit) => {
        let inThrottle;
        let lastResult;
        return function(...args) {
          const context = this;
          if (!inThrottle) {
            lastResult = func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
          }
          return lastResult;
        };
      },
      // 修正：直接使用 tonearmBase 的坐标作为轴心
      getAngleRelativeToPivot: (clientX, clientY, elementsRef) => {
        if (!elementsRef || !elementsRef.tonearmBase) return 0;
        const rect = elementsRef.tonearmBase.getBoundingClientRect();
        const pivotX = rect.left;
        const pivotY = rect.top;
        const angleRad = Math.atan2(clientY - pivotY, clientX - pivotX);
        return angleRad * (180 / Math.PI);
      },
      getEventCoords: (e) => {
        if (e.touches && e.touches.length > 0) return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches.length > 0) return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
        return { clientX: e.clientX, clientY: e.clientY };
      }
    };

    // --- 播放器核心逻辑封装 ---
    function createPlayerLogic(elements) {

        // 状态对象
        const state = {
          isPlaying: false, isLoading: false, hasError: false, isEmpty: false,
          currentTrackIndex: 0, progressAnimId: null, isDraggingTonearm: false,
          tonearmDragStartAngle: 0, isDraggingProgress: false, wasPlayingBeforeDrag: false,
          activeObjectURLs: new Set(), currentObjectURL: null, jsmediatagsAvailable: false,
          playlist: [ // Default playlist
            { title: "SoundHelix Song 1", artist: "SoundHelix", audioSrc: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", albumArt: "https://picsum.photos/seed/song1/200/200", poem: { title: "雨后", author: "林清轩", content: "风停了\n雨歇了\n一缕阳光穿过云层\n落在湿润的青石板上\n\n行人匆匆而过\n只有一朵蒲公英\n停留在时光的缝隙中\n等待下一程旅途", date: "2023年春", location: "杭州西湖", tags: ["春天", "雨", "生活"] }, isLocal: false },
            { title: "SoundHelix Song 2", artist: "SoundHelix", audioSrc: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", albumArt: "https://picsum.photos/seed/song2/200/200", poem: { title: "城市之光", author: "徐明", content: "霓虹灯下\n我们都是匆匆的过客\n在高楼之间寻找\n那一刻的宁静\n\n地铁来了又走\n带走的不只是人流\n还有那些未说出口的话语\n和无处安放的梦想", date: "2023年冬", location: "上海", tags: ["城市", "夜晚", "思考"] }, isLocal: false },
            { title: "SoundHelix Song 3", artist: "SoundHelix", audioSrc: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", albumArt: "https://picsum.photos/seed/song3/200/200", poem: { title: "山间的风", author: "张晓风", content: "山间的风\n轻拂过松林\n带来远方的消息\n和一丝清凉\n\n溪水潺潺\n诉说着古老的故事\n每一块石头\n都藏着岁月的秘密", date: "2023年夏", location: "黄山", tags: ["自然", "风", "山"] }, isLocal: false }
          ]
        };

        // Object URL 管理工具
        const objectUrlUtils = {
            revokeObjectUrl: (url) => {
                if (url && url.startsWith('blob:') && state.activeObjectURLs.has(url)) {
                  try {
                    URL.revokeObjectURL(url);
                    state.activeObjectURLs.delete(url);
                  } catch (err) {
                    // console.error("释放 Object URL 时出错:", url, err); // Removed log
                  }
                }
            },
            revokeAllObjectUrls: () => {
                if (state.activeObjectURLs.size > 0) {
                    // console.log(`准备释放 ${state.activeObjectURLs.size} 个剩余的 Object URL...`); // Removed log
                    state.activeObjectURLs.forEach(url => {
                        try {
                            URL.revokeObjectURL(url);
                        } catch (err) {
                            // console.error("释放 Object URL 时出错:", url, err); // Removed log
                        }
                    });
                    state.activeObjectURLs.clear();
                    state.currentObjectURL = null;
                }
            }
        };

        if (window.jsmediatags) state.jsmediatagsAvailable = true;
        // else console.warn("警告：jsmediatags 库未加载..."); // Removed log

        // --- 内部辅助函数 ---
        const _isActionAllowed = () => {
            // 检查核心状态：不在加载、无错误、列表不为空
            return !state.isLoading && !state.hasError && !state.isEmpty;
        };


        // --- 播放器方法 ---
        const player = {
            // --- 状态更新 ---
            setLoadingState(isLoading) {
                 if (state.isLoading === isLoading) return;
                 state.isLoading = isLoading;
                 elements.playerWrapper?.classList.toggle('loading', isLoading);
                 if (isLoading) this.setErrorState(false);
                 this.setControlsEnabled(!state.isLoading && !state.hasError && !state.isEmpty);
                 // console.log("Loading state:", isLoading); // Removed log
            },
            setErrorState(hasError, message = "发生未知错误") {
                 if (state.hasError === hasError && hasError && elements.errorMessage?.textContent === message) return;
                 if (state.hasError === hasError && !hasError) return;

                 state.hasError = hasError;
                 if (elements.playerWrapper) {
                     elements.playerWrapper.classList.toggle('error', hasError);
                     if (hasError) elements.playerWrapper.classList.remove('loading');
                 }
                 if (elements.errorMessage) elements.errorMessage.textContent = hasError ? message : "";

                 if (hasError) {
                     // console.error("错误状态:", message); // Removed log
                     this.setLoadingState(false);
                     if (state.isPlaying) {
                         elements.audioPlayer?.pause();
                     }
                 }
                //  else { // Removed log
                //      console.log("错误状态已清除。");
                //  }
                 this.setControlsEnabled(!state.isLoading && !state.isEmpty); // 注意: 这里的检查可能需要调整
            },
            setEmptyState(isEmpty) {
                 if (state.isEmpty === isEmpty) return;
                 state.isEmpty = isEmpty;
                 elements.playerWrapper?.classList.toggle('empty', isEmpty);
                 if (isEmpty) {
                    //  console.log("播放列表为空。"); // Removed log
                     if (elements.errorMessage) elements.errorMessage.textContent = "播放列表为空，请添加文件";
                     if (elements.songTitle) elements.songTitle.textContent = "无歌曲";
                     if (elements.songArtist) elements.songArtist.textContent = "";
                     if (elements.albumArt) {
                         elements.albumArt.src = "https://via.placeholder.com/200/666/ccc?text=Empty";
                         elements.albumArt.alt = "播放列表为空";
                     }
                     this.updatePoem({ title: "无诗歌", author: "", content: "请添加音乐...", date: "", location: "", tags: [] });
                     if (state.isPlaying) {
                         elements.audioPlayer?.pause();
                     }
                     objectUrlUtils.revokeObjectUrl(state.currentObjectURL);
                     state.currentObjectURL = null;
                 } else {
                    //  console.log("播放列表不再为空。"); // Removed log
                     if (elements.errorMessage && elements.errorMessage.textContent === "播放列表为空，请添加文件") {
                         elements.errorMessage.textContent = "";
                     }
                     elements.playerWrapper?.classList.remove('error');
                 }
                 this.setControlsEnabled(!state.isLoading && !state.hasError && !state.isEmpty);
            },
            setControlsEnabled(enabled) {
                 const effectiveEnabled = enabled && !state.isLoading && !state.hasError && !state.isEmpty;
                 if (elements.playPauseButton) elements.playPauseButton.disabled = !effectiveEnabled;
                 const multiTrackEnabled = effectiveEnabled && state.playlist.length > 1;
                 if (elements.prevButton) elements.prevButton.disabled = !multiTrackEnabled;
                 if (elements.nextButton) elements.nextButton.disabled = !multiTrackEnabled;
                 if (elements.addLocalButton) elements.addLocalButton.disabled = false;

                 const pointerEvents = effectiveEnabled ? 'auto' : 'none';
                 const cursor = effectiveEnabled ? 'pointer' : 'default';
                 if (elements.progressContainer && elements.progressContainer.style.pointerEvents !== pointerEvents) {
                     elements.progressContainer.style.pointerEvents = pointerEvents;
                     elements.progressContainer.style.cursor = cursor;
                     elements.progressContainer.setAttribute('aria-disabled', String(!effectiveEnabled));
                 }
                 if (elements.tonearmBar && elements.tonearmBar.style.pointerEvents !== pointerEvents) {
                     elements.tonearmBar.style.pointerEvents = pointerEvents;
                     elements.tonearmBar.style.cursor = cursor;
                 }
                 // console.log("Controls enabled:", effectiveEnabled, "Multi-track enabled:", multiTrackEnabled); // Removed log
            },

            // --- UI 更新 ---
            updateButtonUI(isPlaying) {
                if (!elements.playPauseButton || !elements.playIcon || !elements.pauseIcon) return;
                const wasPlaying = elements.playPauseButton.classList.contains('playing');
                if (wasPlaying === isPlaying) return;
                elements.playPauseButton.classList.toggle('playing', isPlaying);
                elements.playIcon.style.display = isPlaying ? 'none' : 'block';
                elements.pauseIcon.style.display = isPlaying ? 'block' : 'none';
                elements.playPauseButton.setAttribute('aria-label', isPlaying ? '暂停' : '播放');
                // console.log("Button UI updated:", isPlaying ? "Playing" : "Paused"); // Removed log
            },
            updateVisuals(isPlaying) {
                 elements.record?.classList.toggle('playing', isPlaying);
                 if (!state.isDraggingTonearm && elements.tonearmRotator) {
                     const targetAngle = isPlaying ? TONEARM_ANGLES.START : TONEARM_ANGLES.RESTING;
                     const currentTransform = elements.tonearmRotator.style.transform;
                     const currentAngleMatch = currentTransform.match(/rotate\(([\-\d\.]+deg)\)/);
                     const currentAngle = currentAngleMatch ? parseFloat(currentAngleMatch[1]) : null;
                     if (currentAngle === null || Math.abs(currentAngle - targetAngle) > 0.1) {
                        elements.tonearmRotator.style.transform = `rotate(${targetAngle}deg)`;
                        // console.log(`Visuals updated: Tonearm moved to ${targetAngle}deg`); // Removed log
                     }
                 }
                 // console.log("Record visuals updated:", isPlaying ? "Playing" : "Paused"); // Removed log
            },
            updateProgressBar() {
                 if (!elements.audioPlayer || !elements.progressBar || !elements.currentTimeDisplay || !elements.durationDisplay || !elements.progressContainer) return;
                 const { duration = 0, currentTime = 0 } = elements.audioPlayer;
                 const isValidDuration = duration && !isNaN(duration) && duration > 0;
                 const progress = isValidDuration ? currentTime / duration : 0;
                 const progressPercent = progress * 100;

                 if (!state.isDraggingProgress) {
                     const currentWidth = parseFloat(elements.progressBar.style.width) || 0;
                     if (Math.abs(currentWidth - progressPercent) > 0.1) {
                         elements.progressBar.style.width = `${progressPercent}%`;
                     }
                 }

                 const formattedCurrentTime = utils.formatTime(currentTime);
                 const formattedDuration = isValidDuration ? utils.formatTime(duration) : '0:00';
                 if (elements.currentTimeDisplay.textContent !== formattedCurrentTime) elements.currentTimeDisplay.textContent = formattedCurrentTime;
                 if (elements.durationDisplay.textContent !== formattedDuration) elements.durationDisplay.textContent = formattedDuration;

                 const ariaNow = isValidDuration ? Math.round(currentTime) : 0;
                 const ariaMax = isValidDuration ? Math.round(duration) : 100;
                 const ariaText = `当前 ${formattedCurrentTime} / 总时长 ${formattedDuration}`;
                 if (elements.progressContainer.getAttribute('aria-valuenow') != ariaNow) elements.progressContainer.setAttribute('aria-valuenow', ariaNow);
                 if (elements.progressContainer.getAttribute('aria-valuemax') != ariaMax) elements.progressContainer.setAttribute('aria-valuemax', ariaMax);
                 if (elements.progressContainer.getAttribute('aria-valuetext') !== ariaText) elements.progressContainer.setAttribute('aria-valuetext', ariaText);
            },
            startProgressAnimation() {
                 this.stopProgressAnimation();
                 const animationStep = () => {
                     if (state.isPlaying && !state.isDraggingTonearm && !state.isDraggingProgress && !state.isLoading && !state.hasError) {
                         this.updateProgressBar();
                         state.progressAnimId = requestAnimationFrame(animationStep);
                     } else {
                         this.updateProgressBar();
                         this.stopProgressAnimation();
                         // console.log("Progress animation stopped."); // Removed log
                     }
                 };
                 if (state.isPlaying && !state.isDraggingTonearm && !state.isDraggingProgress && !state.isLoading && !state.hasError) {
                     state.progressAnimId = requestAnimationFrame(animationStep);
                     // console.log("Progress animation started."); // Removed log
                 }
            },
            stopProgressAnimation() {
                 if (state.progressAnimId) {
                     cancelAnimationFrame(state.progressAnimId);
                     state.progressAnimId = null;
                     // console.log("Progress animation explicitly stopped."); // Removed log
                 }
            },
            updatePoem(poem) {
                 if (!elements.poemTitle || !elements.poemAuthor || !elements.poemContent || !elements.poemDate || !elements.poemLocation || !elements.poemTags || !elements.poemMetaDivider) return;
                 elements.poemTitle.textContent = poem.title || "无题";
                 elements.poemAuthor.textContent = poem.author || "";
                 elements.poemContent.textContent = poem.content || "";
                 elements.poemDate.textContent = poem.date || "";
                 elements.poemLocation.textContent = poem.location || "";
                 elements.poemTags.innerHTML = '';
                 if (poem.tags && Array.isArray(poem.tags)) {
                     poem.tags.forEach(tag => {
                         const tagElement = document.createElement('span');
                         tagElement.className = 'poem-tag';
                         tagElement.textContent = tag;
                         elements.poemTags.appendChild(tagElement);
                     });
                 }
                 const hasDate = !!poem.date;
                 const hasLocation = !!poem.location;
                 elements.poemMetaDivider.classList.toggle('hidden', !(hasDate && hasLocation));
                 // console.log("Poem updated:", poem.title); // Removed log
            },

            // --- 核心播放控制 ---
            loadTrack(trackIndex, autoPlay = false) {
                if (!state.playlist || state.playlist.length === 0) {
                  // console.warn("尝试加载曲目，但播放列表为空。"); // Removed log
                  this.setEmptyState(true); return;
                }
                const index = (trackIndex % state.playlist.length + state.playlist.length) % state.playlist.length;
                if (index >= state.playlist.length) {
                    // console.error("计算得到无效的曲目索引:", index); // Removed log
                    this.setEmptyState(true); return;
                }
                const track = state.playlist[index];
                // console.log(`准备加载曲目 ${index}: ${track.title}`); // Removed log

                this.stopProgressAnimation();
                this.setLoadingState(true);
                this.setErrorState(false);

                if (elements.audioPlayer && !elements.audioPlayer.paused) {
                    elements.audioPlayer.pause();
                } else {
                     state.isPlaying = false;
                     this.updateButtonUI(false);
                     this.updateVisuals(false);
                }

                objectUrlUtils.revokeObjectUrl(state.currentObjectURL);
                state.currentObjectURL = null;
                state.currentTrackIndex = index;

                if (elements.songTitle) elements.songTitle.textContent = track.title || '未知标题';
                if (elements.songArtist) elements.songArtist.textContent = track.artist || '未知艺术家';
                if (elements.albumArt) {
                    const loadingCover = "https://via.placeholder.com/200/eee/ccc?text=加载中...";
                    elements.albumArt.src = loadingCover; elements.albumArt.alt = "加载封面中...";
                    const img = new Image();
                    img.onload = () => { if (state.currentTrackIndex === index) { elements.albumArt.src = img.src; elements.albumArt.alt = `封面: ${track.title}`; } /* else { console.log("封面加载完成，但曲目已切换，忽略更新。"); } */ }; // Removed log
                    img.onerror = () => { if (state.currentTrackIndex === index) { const defaultCover = track.isLocal ? "https://via.placeholder.com/200/ccc/888?text=本地文件" : "https://via.placeholder.com/200/999/eee?text=无封面"; elements.albumArt.src = defaultCover; elements.albumArt.alt = "封面加载失败"; /* console.warn(`封面加载失败: ${artSrc}`); */ } }; // Removed log
                    const artSrc = track.albumArt || (track.isLocal ? "https://via.placeholder.com/200/ccc/888?text=本地文件" : "https://via.placeholder.com/200/999/eee?text=无封面");
                    img.src = artSrc;
                }

                if (elements.audioPlayer) {
                    if (track.isLocal && track.audioSrc.startsWith('blob:')) {
                        if (state.activeObjectURLs.has(track.audioSrc)) state.currentObjectURL = track.audioSrc;
                        else { /* console.warn("重新遇到的本地 Object URL 不在 active set 中，重新添加:", track.audioSrc); */ state.currentObjectURL = track.audioSrc; state.activeObjectURLs.add(track.audioSrc); } // Removed log
                    }
                    elements.audioPlayer.src = track.audioSrc;
                    elements.audioPlayer.currentTime = 0;

                    if (this._currentReadyHandler) elements.audioPlayer.removeEventListener('loadeddata', this._currentReadyHandler);
                    if (this._currentErrorHandler) elements.audioPlayer.removeEventListener('error', this._currentErrorHandler);

                    this._currentReadyHandler = () => {
                        if (state.currentTrackIndex === index && state.isLoading) {
                           // console.log(`曲目 ${index} loadeddata 事件触发`); // Removed log
                           this.setLoadingState(false);
                           this.updateProgressBar();
                           this.setControlsEnabled(true);
                           if (autoPlay) setTimeout(() => this.playAudio(), 50);
                        }
                        // else console.log(`忽略过时的 loadeddata 事件 (当前: ${state.currentTrackIndex}, 触发: ${index})`); // Removed log
                    };
                    this._currentErrorHandler = (e) => this.handleAudioError(e, index);

                    elements.audioPlayer.addEventListener('loadeddata', this._currentReadyHandler, { once: true });
                    elements.audioPlayer.addEventListener('error', this._currentErrorHandler, { once: true });
                    elements.audioPlayer.load();

                } else {
                    // console.error("错误：在 loadTrack 期间 audioPlayer 元素不存在！"); // Removed log
                    this.setErrorState(true, "播放器初始化错误");
                    this.setLoadingState(false);
                }

                this.updatePoem(track.poem || { title: track.isLocal ? "本地乐曲" : "暂无诗篇", author: track.artist || (track.originalFileName || ""), content: track.isLocal ? `正在聆听: ${track.title}` : "...", date: "", location: "", tags: track.isLocal ? ["本地"] : [] });
                this.setControlsEnabled(true);
            },
            handleAudioError(e, trackIndex) {
                 if (state.currentTrackIndex !== trackIndex) { /* console.log(`忽略过时的音频错误事件 (当前: ${state.currentTrackIndex}, 触发: ${trackIndex})`); */ return; } // Removed log
                 const error = elements.audioPlayer ? elements.audioPlayer.error : null;
                 let message = "音频加载/播放失败";
                 if (error) {
                    //  console.error(`音频错误 (曲目 ${trackIndex}, Code: ${error.code}, Message: ${error.message})`, e); // Removed log
                     switch (error.code) {
                         case MediaError.MEDIA_ERR_ABORTED:
                            //  console.warn("音频加载被中止。"); // Removed log
                             this.setLoadingState(false); this.setControlsEnabled(true);
                             if (state.isPlaying) { state.isPlaying = false; this.updateButtonUI(false); this.updateVisuals(false); this.stopProgressAnimation(); }
                             return;
                         case MediaError.MEDIA_ERR_NETWORK: message = "网络错误，无法加载音频。"; break;
                         case MediaError.MEDIA_ERR_DECODE: message = "无法解码音频文件，格式可能已损坏或不支持。"; break;
                         case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: message = "音频格式不支持。"; break;
                         default: message = `发生未知音频错误 (代码: ${error.code})。`;
                     }
                 } else {
                    //  console.error(`未知音频播放错误 (曲目 ${trackIndex}):`, e); // Removed log
                     if (e && e.message) message = `播放错误: ${e.message}`;
                 }
                 this.setErrorState(true, message);
                 this.setControlsEnabled(false); // 确保错误时控件不可用
            },
            playAudio() {
                 // 使用 _isActionAllowed 简化检查
                 if (state.isPlaying || !_isActionAllowed() || !elements.audioPlayer) {
                    //  console.log("播放请求被阻止 (状态不满足或已在播放):", { isPlaying: state.isPlaying, isLoading: state.isLoading, hasError: state.hasError, isEmpty: state.isEmpty }); // Removed log
                     return;
                 }
                //  console.log("尝试播放..."); // Removed log
                 const playPromise = elements.audioPlayer.play();
                 if (playPromise !== undefined) {
                     playPromise.then(() => {
                        //  console.log("播放指令成功 (Promise resolved)。"); // Removed log
                     }).catch(error => {
                        //  console.error("播放 Promise 失败:", error.name, error.message); // Removed log
                         if (error.name === 'NotAllowedError') {
                             this.setErrorState(true, "浏览器阻止了自动播放，请手动点击播放。");
                             state.isPlaying = false; this.updateButtonUI(false); this.updateVisuals(false); this.setControlsEnabled(true);
                         } else if (error.name === 'AbortError') {
                            //  console.warn("播放请求被中止 (AbortError)。"); // Removed log
                              if (state.isPlaying) { state.isPlaying = false; this.updateButtonUI(false); this.updateVisuals(false); this.stopProgressAnimation();}
                              if(state.isLoading) this.setLoadingState(false);
                              this.setControlsEnabled(true);
                         } else this.handleAudioError(error, state.currentTrackIndex);
                     });
                 }
                // else { // Removed log
                //      console.warn("audio.play() did not return a Promise.");
                // }
            },
            pauseAudio() {
                 // 使用 _isActionAllowed 简化检查
                 if (!state.isPlaying || !_isActionAllowed() || !elements.audioPlayer) {
                    //  console.log("暂停请求被阻止 (状态不满足或未在播放):", { isPlaying: state.isPlaying, isLoading: state.isLoading, hasError: state.hasError }); // Removed log
                     return;
                 }
                //  console.log("尝试暂停..."); // Removed log
                 elements.audioPlayer.pause();
            },
            playNextTrack() {
                // 使用 _isActionAllowed 简化检查 (注意: playNext/Prev 主要关心 isLoading)
                if (state.isLoading || state.isEmpty || state.playlist.length <= 1) {
                    // console.log("无法播放下一首:", { isEmpty: state.isEmpty, isLoading: state.isLoading, count: state.playlist.length }); // Removed log
                    if (!state.isEmpty && state.playlist.length === 1 && elements.audioPlayer) elements.audioPlayer.currentTime = 0;
                    return;
                }
                const nextIndex = (state.currentTrackIndex + 1) % state.playlist.length;
                // console.log(`播放下一首: index ${nextIndex}`); // Removed log
                this.loadTrack(nextIndex, true);
            },
            playPrevTrack() {
                 // 使用 _isActionAllowed 简化检查
                 if (state.isLoading || state.isEmpty || state.playlist.length <= 1 || !elements.audioPlayer) {
                    //  console.log("无法播放上一首:", { isEmpty: state.isEmpty, isLoading: state.isLoading, count: state.playlist.length }); // Removed log
                     return;
                 }
                 if (elements.audioPlayer.currentTime < 3) {
                     const prevIndex = (state.currentTrackIndex - 1 + state.playlist.length) % state.playlist.length;
                    //  console.log(`播放上一首: index ${prevIndex}`); // Removed log
                     this.loadTrack(prevIndex, true);
                 } else {
                    //  console.log("重新播放当前曲目。"); // Removed log
                     elements.audioPlayer.currentTime = 0;
                     if (!state.isPlaying) this.playAudio();
                     else this.startProgressAnimation();
                 }
            },
            togglePlayPause() {
                 // 使用 _isActionAllowed 检查核心状态
                 if (!_isActionAllowed()) {
                    //  console.log("切换播放/暂停被阻止 (状态不满足):", { isLoading: state.isLoading, hasError: state.hasError, isEmpty: state.isEmpty }); // Removed log
                     return;
                 }
                 if (state.isPlaying) this.pauseAudio();
                 else this.playAudio();
            },

            // --- 交互处理 ---
            handleProgressClick(e) {
                 // 使用 _isActionAllowed，保留 dragging 和 element 检查
                 if (!_isActionAllowed() || state.isDraggingProgress || !elements.audioPlayer || !elements.progressContainer) return;
                 const { duration = 0 } = elements.audioPlayer;
                 if (!duration || isNaN(duration) || duration <= 0) return;
                 const rect = elements.progressContainer.getBoundingClientRect();
                 const { clientX } = utils.getEventCoords(e);
                 const clickX = clientX - rect.left;
                 const clickProgress = Math.min(1, Math.max(0, clickX / rect.width));
                 elements.audioPlayer.currentTime = clickProgress * duration;
                 this.updateProgressBar();
                 // console.log(`进度条点击跳转到: ${utils.formatTime(elements.audioPlayer.currentTime)}`); // Removed log
            },
            handleTonearmMouseDown(e) {
                 // 使用 _isActionAllowed，保留 element 检查
                 if (!_isActionAllowed() || !elements.tonearmRotator) return;
                 e.preventDefault();
                 state.isDraggingTonearm = true;
                 document.body.style.userSelect = 'none';
                 const currentTransform = elements.tonearmRotator.style.transform;
                 const currentAngleMatch = currentTransform.match(/rotate\(([\-\d\.]+deg)\)/);
                 const currentRotation = currentAngleMatch ? parseFloat(currentAngleMatch[1]) : TONEARM_ANGLES.RESTING;
                 const { clientX, clientY } = utils.getEventCoords(e);
                 const mouseAngle = utils.getAngleRelativeToPivot(clientX, clientY, elements);
                 state.tonearmDragStartAngle = mouseAngle - currentRotation;
                 this.stopProgressAnimation();
                 elements.tonearmRotator.style.transition = 'none';
                //  console.log("开始拖动唱臂..."); // Removed log
            },
            handleTonearmMouseMove: utils.throttle((e) => {
                 if (!state.isDraggingTonearm || !elements.tonearmRotator) return;
                 const { clientX, clientY } = utils.getEventCoords(e);
                 const mouseAngle = utils.getAngleRelativeToPivot(clientX, clientY, elements);
                 let targetRotation = mouseAngle - state.tonearmDragStartAngle;
                 targetRotation = Math.max(TONEARM_DRAG_LIMITS.MIN, Math.min(TONEARM_DRAG_LIMITS.MAX, targetRotation));
                 elements.tonearmRotator.style.transform = `rotate(${targetRotation}deg)`;
                 // console.log(`Tonearm drag: ${targetRotation.toFixed(1)}deg`); // Removed log
            }, TONEARM_DRAG_THROTTLE_MS),
            handleTonearmMouseUp() {
                 if (!state.isDraggingTonearm || !elements.tonearmRotator) return;
                 state.isDraggingTonearm = false;
                 document.body.style.userSelect = '';
                 elements.tonearmRotator.style.transition = '';
                 const currentTransform = elements.tonearmRotator.style.transform;
                 const finalAngleMatch = currentTransform.match(/rotate\(([\-\d\.]+deg)\)/);
                 const finalRotation = finalAngleMatch ? parseFloat(finalAngleMatch[1]) : TONEARM_ANGLES.RESTING;
                 // console.log(`结束拖动唱臂于: ${finalRotation.toFixed(1)}deg`); // Removed log

                 if (Math.abs(finalRotation - TONEARM_ANGLES.START) < Math.abs(finalRotation - TONEARM_ANGLES.RESTING)) {
                    //  console.log("唱臂落在播放区，尝试播放..."); // Removed log
                     elements.tonearmRotator.style.transform = `rotate(${TONEARM_ANGLES.START}deg)`;
                     this.playAudio();
                 } else {
                    //  console.log("唱臂落在静止区，尝试暂停..."); // Removed log
                     elements.tonearmRotator.style.transform = `rotate(${TONEARM_ANGLES.RESTING}deg)`;
                     this.pauseAudio();
                 }
            },
            handleProgressMouseDown(e) {
                 // 使用 _isActionAllowed，保留 element 检查
                 if (!_isActionAllowed() || !elements.audioPlayer) return;
                 if (e.button !== 0 && !(e.type.startsWith('touch'))) return;
                 e.preventDefault();
                 state.isDraggingProgress = true;
                 document.body.style.userSelect = 'none';
                 state.wasPlayingBeforeDrag = state.isPlaying;
                 this.stopProgressAnimation();
                 if (state.wasPlayingBeforeDrag) {
                     elements.audioPlayer.pause();
                    //  console.log("拖动进度条开始，暂停播放。"); // Removed log
                 }
                // else { // Removed log
                    //  console.log("拖动进度条开始 (之前未播放)。");
                // }
                 this.handleProgressDrag(e);
            },
            handleProgressMouseMove: utils.throttle((e) => {
                if (!state.isDraggingProgress) return;
                this.handleProgressDrag(e);
            }, PROGRESS_DRAG_THROTTLE_MS),
            handleProgressMouseUp(e) {
                 if (!state.isDraggingProgress) return;
                 state.isDraggingProgress = false;
                 document.body.style.userSelect = '';
                 this.handleProgressDrag(e);
                //  console.log(`结束拖动进度条于: ${utils.formatTime(elements.audioPlayer.currentTime)}`); // Removed log

                 if (state.wasPlayingBeforeDrag) {
                     setTimeout(() => {
                         if (elements.audioPlayer && elements.audioPlayer.paused && !state.hasError && !state.isLoading && !state.isEmpty) {
                            // console.log("恢复播放..."); // Removed log
                            this.playAudio();
                         } else if (state.isPlaying) {
                            //  console.log("拖动结束，但已在播放，仅重启动画。"); // Removed log
                             this.startProgressAnimation();
                         }
                        // else { // Removed log
                            // console.log("拖动结束，但不满足恢复播放条件。");
                        // }
                     }, 10);
                 } else {
                     this.updateProgressBar();
                    //  console.log("拖动结束，保持暂停状态。"); // Removed log
                 }
                 state.wasPlayingBeforeDrag = false;
             },
             handleProgressDrag(e) {
                 if (!elements.audioPlayer || !elements.progressContainer) return;
                 const { duration = 0 } = elements.audioPlayer;
                 if (!duration || isNaN(duration) || duration <= 0) return;
                 const rect = elements.progressContainer.getBoundingClientRect();
                 const { clientX } = utils.getEventCoords(e);
                 const clickX = clientX - rect.left;
                 let progress = Math.min(1, Math.max(0, clickX / rect.width));
                 const newTime = progress * duration;
                 if (Math.abs(elements.audioPlayer.currentTime - newTime) > 0.1) elements.audioPlayer.currentTime = newTime;
                 if (elements.progressBar) elements.progressBar.style.width = `${progress * 100}%`;
                 this.updateProgressBar();
             },

            // --- 本地文件处理 ---
            handleAddLocalClick() {
                if (elements.localFileInput) {
                    elements.localFileInput.value = null;
                    elements.localFileInput.click();
                    // console.log("打开本地文件选择器..."); // Removed log
                } else {
                    // console.error("无法找到本地文件输入元素。"); // Removed log
                    this.setErrorState(true, "无法打开文件选择器。");
                }
            },
            handleLocalFileChange(e) {
                const file = e.target.files?.[0]; if (!file) { /* console.log("未选择文件。"); */ return; } // Removed log
                // console.log(`选择了本地文件: ${file.name}, 类型: ${file.type}, 大小: ${file.size} bytes`); // Removed log

                if (!file.type.startsWith('audio/')) { /* console.warn(`文件类型 "${file.type}" 可能不被支持，继续尝试加载...`); */ } // Removed log
                if (elements.audioPlayer?.canPlayType && elements.audioPlayer.canPlayType(file.type) === '') {
                    //  console.error(`浏览器明确表示不支持此音频格式: ${file.type || '未知'}`); // Removed log
                     this.setErrorState(true, `浏览器不支持此音频格式: ${file.type || '未知'}`); e.target.value = null; return;
                }

                if (state.jsmediatagsAvailable && window.jsmediatags) {
                    // console.log("使用 jsmediatags 读取元数据..."); // Removed log
                    window.jsmediatags.read(file, {
                        onSuccess: (tag) => {
                            // console.log("jsmediatags 读取成功:", tag); // Removed log
                            const tags = tag.tags;
                            const title = tags.title || file.name.replace(/\.[^/.]+$/, "");
                            const artist = tags.artist || "本地文件";
                            let albumArtDataUrl = null;
                            if (tags.picture) {
                                try { const { data, format } = tags.picture; let base64String = ""; for (let i = 0; i < data.length; i++) base64String += String.fromCharCode(data[i]); albumArtDataUrl = `data:${format};base64,${window.btoa(base64String)}`; /* console.log("成功提取内嵌封面图。"); */ } // Removed log
                                catch (err) { /* console.error("处理内嵌封面图时出错:", err); */ } // Removed log
                            }
                            // else { console.log("未找到内嵌封面图。"); } // Removed log
                            this.addLocalTrack(file, title, artist, albumArtDataUrl, file.name);
                            e.target.value = null;
                        },
                        onError: (error) => {
                            // console.error('jsmediatags 读取元数据失败:', error.type, error.info); // Removed log
                            this.addLocalTrack(file, file.name.replace(/\.[^/.]+$/, ""), "本地文件", null, file.name);
                            this.setErrorState(false); setTimeout(() => this.setErrorState(true, "无法读取文件的详细信息。"), 100); setTimeout(() => this.setErrorState(false), 3000);
                            e.target.value = null;
                        }
                    });
                } else {
                    // console.log("jsmediatags 不可用，直接添加本地文件。"); // Removed log
                    this.addLocalTrack(file, file.name.replace(/\.[^/.]+$/, ""), "本地文件", null, file.name);
                    e.target.value = null;
                }
            },
            addLocalTrack(file, title, artist, albumArtDataUrl, originalFileName) {
                let objectURL = null;
                try {
                    objectURL = URL.createObjectURL(file);
                    state.activeObjectURLs.add(objectURL);
                    // console.log(`创建 Object URL: ${objectURL.substring(0, 15)}... for ${originalFileName}`); // Removed log
                } catch (err) {
                    // console.error("创建本地音频 Object URL 失败:", err); // Removed log
                    this.setErrorState(true, "创建本地音频链接失败。"); return;
                }

                const newTrack = { title, artist, audioSrc: objectURL, albumArt: albumArtDataUrl, poem: { title: "本地乐曲", author: artist || originalFileName, content: `正在聆听: ${title}\n来自: ${originalFileName}`, date: new Date().toLocaleDateString('zh-CN'), location: "我的设备", tags: ["本地", "自定义"] }, isLocal: true, originalFileName };

                state.playlist.push(newTrack);
                // console.log(`本地曲目 "${title}" 已添加到播放列表。当前共 ${state.playlist.length} 首。`); // Removed log

                if (state.isEmpty) this.setEmptyState(false);
                const newIndex = state.playlist.length - 1;
                this.loadTrack(newIndex, false);
                this.setControlsEnabled(true);
            },

             // *** 音频元素事件处理函数 ***
             handleAudioPlayEvent() {
                // console.log("事件: play (由 handleAudioPlayEvent 处理)"); // Removed log
                state.isPlaying = true; state.isLoading = false; state.hasError = false;
                this.updateButtonUI(true); this.updateVisuals(true); this.startProgressAnimation();
             },
             handleAudioPauseEvent() {
                // console.log("事件: pause (由 handleAudioPauseEvent 处理)"); // Removed log
                state.isPlaying = false;
                if (!state.isDraggingProgress) {
                    this.updateButtonUI(false); this.updateVisuals(false); this.stopProgressAnimation();
                } else {
                    this.updateButtonUI(false);
                    // console.log("Pause event during progress drag, visuals not updated."); // Removed log
                }
             },
             handleAudioEndedEvent() {
                // console.log("事件: ended (由 handleAudioEndedEvent 处理)"); // Removed log
                state.isPlaying = false;
                this.updateButtonUI(false); this.updateVisuals(false); this.stopProgressAnimation();
                // console.log("歌曲播放结束，尝试播放下一首。"); // Removed log
                this.playNextTrack();
             },
             handleAudioTimeUpdateEvent() {
                 if (!state.isDraggingTonearm && !state.isDraggingProgress) {
                     this.updateProgressBar();
                 }
             },
             handleAudioLoadedMetadataEvent() {
                // console.log("事件: loadedmetadata (由 handleAudioLoadedMetadataEvent 处理)"); // Removed log
                this.updateProgressBar(); this.setControlsEnabled(true);
             },
             handleAudioWaitingEvent() {
                // console.log("事件: waiting (缓冲中...) (由 handleAudioWaitingEvent 处理)"); // Removed log
                if (state.isPlaying && !state.isLoading) {
                    this.setLoadingState(true);
                }
             },
             handleAudioPlayingEvent() {
                 // console.log("事件: playing (缓冲结束/开始播放) (由 handleAudioPlayingEvent 处理)"); // Removed log
                 if (state.isLoading) this.setLoadingState(false);
                 state.isPlaying = true; state.hasError = false;
                 this.updateButtonUI(true); this.updateVisuals(true); this.startProgressAnimation();
             },

            // 暴露 Object URL 清理方法
            cleanupObjectUrls: objectUrlUtils.revokeAllObjectUrls,

            // （可选）暴露获取当前曲目信息的接口，供外部使用（如封面错误处理）
            getCurrentTrackInfo: () => state.playlist[state.currentTrackIndex] || null

        }; // end of player object

        return player;

    } // end of createPlayerLogic function


    // --- 事件监听器设置 ---
    function setupEventListeners(elements, player) {
        // console.log("正在设置事件监听器..."); // Removed log
        function safeAddEventListener(element, event, handler, options) {
            if (element) element.addEventListener(event, handler, options);
            // else console.warn(`尝试为不存在的元素添加 "${event}" 事件监听器。`); // Removed log
        }

        // Controls
        safeAddEventListener(elements.playPauseButton, 'click', () => player.togglePlayPause());
        safeAddEventListener(elements.prevButton, 'click', () => player.playPrevTrack());
        safeAddEventListener(elements.nextButton, 'click', () => player.playNextTrack());
        safeAddEventListener(elements.addLocalButton, 'click', () => player.handleAddLocalClick());
        safeAddEventListener(elements.localFileInput, 'change', (e) => player.handleLocalFileChange(e));

        // Progress Bar Interaction
        safeAddEventListener(elements.progressContainer, 'click', (e) => player.handleProgressClick(e));
        safeAddEventListener(elements.progressContainer, 'mousedown', (e) => player.handleProgressMouseDown(e), { capture: true });
        safeAddEventListener(elements.progressContainer, 'touchstart', (e) => player.handleProgressMouseDown(e), { passive: false, capture: true });

        // Tonearm Interaction
        safeAddEventListener(elements.tonearmBar, 'mousedown', (e) => player.handleTonearmMouseDown(e));
        safeAddEventListener(elements.tonearmBar, 'touchstart', (e) => player.handleTonearmMouseDown(e), { passive: false });

        // Global Drag Handlers
        document.addEventListener('mousemove', (e) => { player.handleProgressMouseMove(e); player.handleTonearmMouseMove(e); });
        document.addEventListener('touchmove', (e) => { player.handleProgressMouseMove(e); player.handleTonearmMouseMove(e); }, { passive: true });
        document.addEventListener('mouseup', (e) => { player.handleProgressMouseUp(e); player.handleTonearmMouseUp(e); });
        document.addEventListener('touchend', (e) => { player.handleProgressMouseUp(e); player.handleTonearmMouseUp(e); });
        document.addEventListener('touchcancel', (e) => { /* console.log("Touch cancel event detected."); */ player.handleProgressMouseUp(e); player.handleTonearmMouseUp(e); }); // Removed log

        // Keyboard Accessibility
        document.addEventListener('keydown', (e) => {
            const activeEl = document.activeElement;
            const isInputFocused = activeEl && ( activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable || activeEl.closest('button, [role=slider], [role=button]') );
            if (e.code === 'Space' && !isInputFocused) { e.preventDefault(); player.togglePlayPause(); }
        });

        // Audio Element Events
        if (elements.audioPlayer) {
            safeAddEventListener(elements.audioPlayer, 'play', () => player.handleAudioPlayEvent());
            safeAddEventListener(elements.audioPlayer, 'pause', () => player.handleAudioPauseEvent());
            safeAddEventListener(elements.audioPlayer, 'ended', () => player.handleAudioEndedEvent());
            safeAddEventListener(elements.audioPlayer, 'timeupdate', () => player.handleAudioTimeUpdateEvent());
            safeAddEventListener(elements.audioPlayer, 'loadedmetadata', () => player.handleAudioLoadedMetadataEvent());
            safeAddEventListener(elements.audioPlayer, 'waiting', () => player.handleAudioWaitingEvent());
            safeAddEventListener(elements.audioPlayer, 'playing', () => player.handleAudioPlayingEvent());
        }
        // else console.error("错误：无法添加音频事件监听器，audioPlayer 元素不存在！"); // Removed log

        // Album Art Error Handling
        safeAddEventListener(elements.albumArt, 'error', () => {
            if (elements.albumArt && elements.albumArt.src) {
                const isPlaceholder = elements.albumArt.src.includes("via.placeholder.com") || elements.albumArt.src.includes("?text=");
                if (!isPlaceholder) {
                    // console.warn(`封面图片加载失败: ${elements.albumArt.src}`); // Removed log
                    // 使用暴露的接口获取当前曲目信息
                    const currentTrack = player.getCurrentTrackInfo ? player.getCurrentTrackInfo() : null;
                    const defaultCover = currentTrack?.isLocal ? "https://via.placeholder.com/200/ccc/888?text=本地文件" : "https://via.placeholder.com/200/999/eee?text=无封面";
                    elements.albumArt.src = defaultCover;
                    elements.albumArt.alt = "封面加载失败";
                }
            }
        });

        // Page Lifecycle Event for Cleanup
        window.addEventListener('pagehide', () => { /* console.log("页面隐藏，清理 Object URLs..."); */ player.cleanupObjectUrls(); }); // Removed log
        window.addEventListener('beforeunload', () => { /* console.log("页面即将卸载，清理 Object URLs..."); */ player.cleanupObjectUrls(); }); // Removed log

        // console.log("事件监听器设置完成。"); // Removed log
    }

    // --- Initialization Function ---
    function init() {
        // console.log("开始初始化播放器..."); // Removed log
        const { elements, allFound } = getElements();
        if (!allFound) {
             const errorDiv = document.createElement('div'); errorDiv.className = 'init-error-message';
             errorDiv.textContent = '播放器加载失败：关键页面元素缺失。';
             const targetContainer = elements.playerSection || document.body;
             if (elements.playerSection) elements.playerSection.innerHTML = '';
             targetContainer.appendChild(errorDiv);
            //  console.error("初始化失败：关键 DOM 元素未找到。"); // Removed log
             return;
        }

        const player = createPlayerLogic(elements);
        setupEventListeners(elements, player);

        player.setControlsEnabled(false);
        player.loadTrack(0, false);

        if (elements.tonearmRotator) elements.tonearmRotator.style.transform = `rotate(${TONEARM_ANGLES.RESTING}deg)`;
        player.updateButtonUI(false);

        // console.log("播放器初始化成功。"); // Removed log
    }


    // --- Start Initialization on DOM Ready ---
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})(); // End of IIFE