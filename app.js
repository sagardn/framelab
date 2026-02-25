/* FrameLab — Advanced Video Analysis Tool (Seek-on-Demand Architecture) */
(function () {
    "use strict";

    // ═══════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════
    const S = {
        video: null,
        currentFrame: 0,
        totalFrames: 0,
        fps: 30,
        width: 0,
        height: 0,
        duration: 0,
        playing: false,
        playTimer: null,
        playSpeed: 1.0,
        zoom: 1,
        panX: 0,
        panY: 0,
        isPanning: false,
        panStartX: 0,
        panStartY: 0,
        viewMode: "single",
        markers: [],
        fileName: "",
        videoFiles: [],
        activeVideoIdx: -1,
        seeking: false,
        compA: -1,
        compB: -1,
        compPending: false,
        compQueued: false,
    };

    // ═══════════════════════════════════════
    // DOM REFS
    // ═══════════════════════════════════════
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        fileInput: $("#fileInput"),
        dropZone: $("#dropZone"),
        progressWrapper: $("#progressWrapper"),
        progressBar: $("#progressBar"),
        mainCanvas: $("#mainCanvas"),
        canvasWrapper: $("#canvasWrapper"),
        folderInput: $("#folderInput"),
        videoListPanel: $("#videoListPanel"),
        videoList: $("#videoList"),
        noVideoMsg: $("#noVideoMsg"),
        frameSlider: $("#frameSlider"),
        frameNum: $("#frameNum"),
        frameControlsBar: $("#frameControlsBar"),
        videoInfoPanel: $("#videoInfoPanel"),
        playbackPanel: $("#playbackPanel"),
        markersPanel: $("#markersPanel"),
        histPanel: $("#histPanel"),
        chkLockFrame: $("#chkLockFrame"),
        frameDetailPanel: $("#frameDetailPanel"),
        histCanvas: $("#histCanvas"),
        gridOverlay: $("#gridOverlay"),
        frameGrid: $("#frameGrid"),
        compareOverlay: $("#compareOverlay"),
        diffOverlay: $("#diffOverlay"),
        compCanvasA: $("#compCanvasA"),
        compCanvasB: $("#compCanvasB"),
        compSliderA: $("#compSliderA"),
        compSliderB: $("#compSliderB"),
        diffCanvas: $("#diffCanvas"),
        markersList: $("#markersList"),
        statusText: $("#statusText"),
        statusZoom: $("#statusZoom"),
        speedBadge: $("#speedBadge"),
        extractOverlay: $("#extractOverlay"),
        overlapOverlay: $("#overlapOverlay"),
        extractCanvas: $("#extractCanvas"),
        overlapCanvas: $("#overlapCanvas"),
    };

    // Load saved settings
    try {
        if (localStorage.getItem("framelab_zoom")) S.zoom = parseFloat(localStorage.getItem("framelab_zoom")) || 1;
        if (localStorage.getItem("framelab_lockFrame")) {
            if (dom.chkLockFrame) dom.chkLockFrame.checked = localStorage.getItem("framelab_lockFrame") === "true";
        }
    } catch (e) {}

    const mainCtx = dom.mainCanvas.getContext("2d");
    const histCtx = dom.histCanvas.getContext("2d");

    // ═══════════════════════════════════════
    // VIDEO LOADING (no frame pre-extraction!)
    // ═══════════════════════════════════════
    function loadVideo(file) {
        S.fileName = file.name;

        // Preserve frame state if Lock Frame is checked
        if (!dom.chkLockFrame || !dom.chkLockFrame.checked) {
            S.currentFrame = 0;
            S.compA = -1;
            S.compB = -1;
        }

        S.markers = [];
        try {
            const savedM = localStorage.getItem("framelab_markers_" + S.fileName);
            if (savedM) S.markers = JSON.parse(savedM);
        } catch (e) {}

        S.seeking = false;
        stopPlay();
        dom.statusText.textContent = "Loading video...";

        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.src = url;
        S.video = video;

        video.addEventListener("loadedmetadata", () => {
            S.width = video.videoWidth;
            S.height = video.videoHeight;
            S.duration = video.duration;
            S.fps = 30;
            S.totalFrames = Math.max(1, Math.round(S.duration * S.fps));
            finishLoading();
        });

        video.addEventListener("error", () => {
            dom.statusText.textContent = "Error loading video";
        });
    }

    function finishLoading() {
        dom.statusText.textContent = `Loaded: ${S.totalFrames} frames (${formatTime(S.duration)})`;
        dom.noVideoMsg.classList.add("hidden");
        dom.mainCanvas.classList.remove("hidden");
        dom.frameControlsBar.classList.remove("hidden");
        dom.videoInfoPanel.classList.remove("hidden");
        dom.playbackPanel.classList.remove("hidden");
        dom.markersPanel.classList.remove("hidden");
        dom.histPanel.classList.remove("hidden");
        dom.frameDetailPanel.classList.remove("hidden");
        $("#btnExport").disabled = false;

        $("#extractHint").textContent = `/ ${S.totalFrames}`;
        $("#extractFrameNum").max = S.totalFrames;

        const maxFrame = S.totalFrames - 1;

        // Clamp preserved frames to the new video's length
        if (dom.chkLockFrame && dom.chkLockFrame.checked) {
            S.currentFrame = Math.min(S.currentFrame, maxFrame);
            if (S.compA !== -1) S.compA = Math.min(S.compA, maxFrame);
            if (S.compB !== -1) S.compB = Math.min(S.compB, maxFrame);
        }

        dom.frameSlider.max = maxFrame;
        dom.frameSlider.value = S.currentFrame;

        dom.compSliderA.max = maxFrame;
        dom.compSliderB.max = maxFrame;

        if (!dom.chkLockFrame || !dom.chkLockFrame.checked) {
            dom.compSliderA.value = 0;
            dom.compSliderB.value = 0;
            S.compA = -1;
            S.compB = -1;
        } else {
            dom.compSliderA.value = S.compA !== -1 ? S.compA : 0;
            dom.compSliderB.value = S.compB !== -1 ? S.compB : 0;
        }

        S.compPending = false;
        S.compQueued = false;

        $("#infoName").textContent = S.fileName.length > 20 ? S.fileName.slice(0, 17) + "…" : S.fileName;
        $("#infoRes").textContent = `${S.width}×${S.height}`;
        $("#infoDur").textContent = formatTime(S.duration);
        $("#infoFps").textContent = S.fps.toFixed(1);
        $("#infoFrames").textContent = S.totalFrames;
        $("#infoFormat").textContent = S.fileName.split(".").pop().toUpperCase();

        // If in Compare mode, trigger compare render to respect preserved sliders
        if (S.viewMode === "compare") {
            renderCompare();
        } else {
            renderFrame(S.currentFrame);
        }
    }

    // ═══════════════════════════════════════
    // SEEK-ON-DEMAND FRAME ACCESS
    // ═══════════════════════════════════════
    function frameTime(idx) {
        return Math.min(S.duration, idx / S.fps);
    }

    // Seek video to a frame index, returns a Promise that resolves when ready
    function seekTo(idx) {
        return new Promise((resolve) => {
            const t = frameTime(idx);
            if (Math.abs(S.video.currentTime - t) < 0.001) {
                resolve();
                return;
            }
            S.video.onseeked = () => {
                S.video.onseeked = null;
                resolve();
            };
            S.video.currentTime = t;
        });
    }

    // Get ImageData for a frame (seeks and captures)
    function captureFrame(idx) {
        return seekTo(idx).then(() => {
            const c = document.createElement("canvas");
            c.width = S.width;
            c.height = S.height;
            c.getContext("2d").drawImage(S.video, 0, 0, S.width, S.height);
            return c.getContext("2d").getImageData(0, 0, S.width, S.height);
        });
    }

    // Capture multiple frames sequentially (for overlap/diff)
    function captureFrames(indices) {
        const results = [];
        let chain = Promise.resolve();
        for (const idx of indices) {
            chain = chain.then(() => captureFrame(idx).then((d) => results.push(d)));
        }
        return chain.then(() => results);
    }

    // ═══════════════════════════════════════
    // FRAME RENDERING
    // ═══════════════════════════════════════
    let pendingFrame = null;

    function renderFrame(idx) {
        if (idx < 0 || idx >= S.totalFrames) return;
        if (S.seeking) {
            // Queue the latest request — it will be picked up after current seek
            pendingFrame = idx;
            return;
        }
        S.currentFrame = idx;
        S.seeking = true;
        pendingFrame = null;

        seekTo(idx).then(() => {
            dom.mainCanvas.width = S.width;
            dom.mainCanvas.height = S.height;
            mainCtx.clearRect(0, 0, S.width, S.height);
            mainCtx.drawImage(S.video, 0, 0, S.width, S.height);
            applyTransform();

            dom.frameSlider.value = idx;
            dom.frameNum.textContent = `${idx + 1} / ${S.totalFrames}`;
            updateFrameDetails(idx);
            drawHistogram();
            S.seeking = false;

            // If another frame was requested while seeking, render it now
            if (pendingFrame !== null && pendingFrame !== idx) {
                const next = pendingFrame;
                pendingFrame = null;
                renderFrame(next);
            }
        });
    }

    function applyTransform() {
        const t = `scale(${S.zoom}) translate(${S.panX}px, ${S.panY}px)`;
        dom.mainCanvas.style.transform = t;
    }

    function updateFrameDetails(idx) {
        const time = (idx / S.fps).toFixed(3);
        $("#detailFrame").textContent = idx + 1;
        $("#detailTime").textContent = time + "s";

        // Downscale image data for performance logic to prevent unresponsiveness on large files
        const maxDim = 640;
        let pW = S.width, pH = S.height;
        if (pW > maxDim || pH > maxDim) {
            const ratio = Math.min(maxDim / pW, maxDim / pH);
            pW = Math.round(pW * ratio);
            pH = Math.round(pH * ratio);
        }
        const tempC = document.createElement("canvas");
        tempC.width = pW; tempC.height = pH;
        tempC.getContext("2d").drawImage(S.video, 0, 0, pW, pH);
        const data = tempC.getContext("2d").getImageData(0, 0, pW, pH).data;

        let sum = 0;
        const len = data.length;
        for (let i = 0; i < len; i += 16) {
            sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        const avg = (sum / (len / 16)).toFixed(1);
        $("#detailBright").textContent = avg;

        const colorBuckets = {};
        for (let i = 0; i < len; i += 64) {
            const r = Math.round(data[i] / 32) * 32;
            const g = Math.round(data[i + 1] / 32) * 32;
            const b = Math.round(data[i + 2] / 32) * 32;
            const key = `${r},${g},${b}`;
            colorBuckets[key] = (colorBuckets[key] || 0) + 1;
        }
        let maxKey = "0,0,0";
        let maxCount = 0;
        for (const k in colorBuckets) {
            if (colorBuckets[k] > maxCount) {
                maxCount = colorBuckets[k];
                maxKey = k;
            }
        }
        const [dr, dg, db] = maxKey.split(",");
        const domColorEl = $("#detailDomColor");
        domColorEl.textContent = `rgb(${dr},${dg},${db})`;
        domColorEl.style.color = `rgb(${dr},${dg},${db})`;
    }

    // ═══════════════════════════════════════
    // HISTOGRAM
    // ═══════════════════════════════════════
    function drawHistogram() {
        const maxDim = 320;
        let pW = S.width, pH = S.height;
        if (pW > maxDim || pH > maxDim) {
            const ratio = Math.min(maxDim / pW, maxDim / pH);
            pW = Math.round(pW * ratio);
            pH = Math.round(pH * ratio);
        }
        const tempC = document.createElement("canvas");
        tempC.width = pW; tempC.height = pH;
        tempC.getContext("2d").drawImage(S.video, 0, 0, pW, pH);
        const data = tempC.getContext("2d").getImageData(0, 0, pW, pH).data;

        const rHist = new Uint32Array(256);
        const gHist = new Uint32Array(256);
        const bHist = new Uint32Array(256);

        for (let i = 0; i < data.length; i += 16) {
            rHist[data[i]]++;
            gHist[data[i + 1]]++;
            bHist[data[i + 2]]++;
        }

        const maxVal = Math.max(
            ...rHist.slice(1, 255),
            ...gHist.slice(1, 255),
            ...bHist.slice(1, 255),
            1
        );

        const w = dom.histCanvas.width = dom.histCanvas.offsetWidth * 2;
        const h = dom.histCanvas.height = 240;
        histCtx.clearRect(0, 0, w, h);
        histCtx.globalAlpha = 0.5;

        const barW = w / 256;
        const colors = [
            { hist: rHist, color: "#ef4444" },
            { hist: gHist, color: "#22c55e" },
            { hist: bHist, color: "#3b82f6" },
        ];

        for (const ch of colors) {
            histCtx.fillStyle = ch.color;
            for (let i = 0; i < 256; i++) {
                const barH = (ch.hist[i] / maxVal) * h;
                histCtx.fillRect(i * barW, h - barH, barW + 0.5, barH);
            }
        }
        histCtx.globalAlpha = 1;
    }

    // ═══════════════════════════════════════
    // GRID VIEW (renders thumbnails on-demand)
    // ═══════════════════════════════════════
    function buildGrid() {
        dom.frameGrid.innerHTML = "";
        const maxThumbs = 60;
        const step = Math.max(1, Math.floor(S.totalFrames / maxThumbs));
        dom.statusText.textContent = "Building grid...";

        const indices = [];
        for (let i = 0; i < S.totalFrames; i += step) indices.push(i);

        // Render thumbnails sequentially to avoid hammering seeks
        let q = 0;
        function nextThumb() {
            if (q >= indices.length) {
                dom.statusText.textContent = `Grid: ${indices.length} thumbnails`;
                return;
            }
            const i = indices[q];
            seekTo(i).then(() => {
                const thumb = document.createElement("canvas");
                thumb.width = 160;
                thumb.height = 90;
                thumb.className = "grid-thumb";
                if (S.markers.includes(i)) thumb.classList.add("marked");
                thumb.title = `Frame ${i + 1}`;
                thumb.getContext("2d").drawImage(S.video, 0, 0, 160, 90);
                thumb.addEventListener("click", () => {
                    S.currentFrame = i;
                    setView("single");
                });
                dom.frameGrid.appendChild(thumb);
                q++;
                requestAnimationFrame(nextThumb);
            });
        }
        nextThumb();
    }

    // ═══════════════════════════════════════
    // COMPARE VIEW
    // ═══════════════════════════════════════
    function renderCompare() {
        if (S.compPending) {
            S.compQueued = true;
            return;
        }
        S.compPending = true;

        const idxA = parseInt(dom.compSliderA.value);
        const idxB = parseInt(dom.compSliderB.value);

        let p = Promise.resolve();

        if (idxA !== S.compA) {
            p = p.then(() => seekAndDraw(dom.compCanvasA, idxA)).then(() => {
                $("#compALabel").textContent = idxA + 1;
                S.compA = idxA;
            });
        }
        if (idxB !== S.compB) {
            p = p.then(() => seekAndDraw(dom.compCanvasB, idxB)).then(() => {
                $("#compBLabel").textContent = idxB + 1;
                S.compB = idxB;
            });
        }

        p.then(() => {
            S.compPending = false;
            if (S.compQueued) {
                S.compQueued = false;
                renderCompare();
            }
        });
    }

    function seekAndDraw(canvas, idx) {
        if (idx < 0 || idx >= S.totalFrames) return Promise.resolve();
        canvas.width = S.width;
        canvas.height = S.height;
        return seekTo(idx).then(() => {
            canvas.getContext("2d").drawImage(S.video, 0, 0, S.width, S.height);
        });
    }

    // ═══════════════════════════════════════
    // DIFF VIEW (Motion Detection)
    // ═══════════════════════════════════════
    function renderDiff() {
        if (S.currentFrame < 1) return;
        const idxA = S.currentFrame - 1;
        const idxB = S.currentFrame;

        captureFrames([idxA, idxB]).then((frames) => {
            const dataA = frames[0].data;
            const dataB = frames[1].data;

            dom.diffCanvas.width = S.width;
            dom.diffCanvas.height = S.height;
            const ctx = dom.diffCanvas.getContext("2d");
            const out = ctx.createImageData(S.width, S.height);

            for (let i = 0; i < dataA.length; i += 4) {
                const dr = Math.abs(dataA[i] - dataB[i]);
                const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
                const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
                const diff = (dr + dg + db) / 3;
                const amp = Math.min(255, diff * 4);
                out.data[i] = amp > 30 ? 255 : 0;
                out.data[i + 1] = amp > 30 ? amp * 0.3 : 0;
                out.data[i + 2] = amp > 30 ? amp * 0.8 : 0;
                out.data[i + 3] = 255;
            }
            ctx.putImageData(out, 0, 0);
        });
    }

    // ═══════════════════════════════════════
    // ZOOM & PAN
    // ═══════════════════════════════════════
    dom.canvasWrapper.addEventListener("mousedown", (e) => {
        if (S.totalFrames === 0 || S.viewMode !== "single") return;
        S.isPanning = true;
        S.panStartX = e.clientX - S.panX;
        S.panStartY = e.clientY - S.panY;
        dom.canvasWrapper.style.cursor = "grabbing";
    });
    dom.canvasWrapper.addEventListener("mousemove", (e) => {
        if (!S.isPanning) return;
        S.panX = e.clientX - S.panStartX;
        S.panY = e.clientY - S.panStartY;
        applyTransform();
    });
    dom.canvasWrapper.addEventListener("mouseup", () => {
        S.isPanning = false;
        dom.canvasWrapper.style.cursor = "";
    });
    dom.canvasWrapper.addEventListener("mouseleave", () => {
        S.isPanning = false;
    });
    dom.canvasWrapper.addEventListener("wheel", (e) => {
        if (S.totalFrames === 0 || S.viewMode !== "single") return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        S.zoom = Math.max(0.2, Math.min(5, S.zoom + delta));
        applyTransform();
        dom.statusZoom.textContent = `Zoom: ${Math.round(S.zoom * 100)}%`;
        try { localStorage.setItem("framelab_zoom", S.zoom); } catch(ex){}
    });

    // ═══════════════════════════════════════
    // PLAYBACK
    // ═══════════════════════════════════════
    function togglePlay() {
        if (S.playing) {
            stopPlay();
        } else {
            S.playing = true;
            $("#btnPlay").textContent = "⏸";
            playNext();
        }
    }

    function playNext() {
        if (!S.playing) return;
        let next = S.currentFrame + 1;
        if (next >= S.totalFrames) next = 0;
        renderFrame(next);
        S.playTimer = setTimeout(playNext, 1000 / (S.fps * S.playSpeed));
    }

    function stopPlay() {
        S.playing = false;
        clearTimeout(S.playTimer);
        $("#btnPlay").textContent = "▶";
    }

    // ═══════════════════════════════════════
    // VIEW SWITCHING
    // ═══════════════════════════════════════
    function setView(mode) {
        S.viewMode = mode;
        $$(".view-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === mode));
        dom.mainCanvas.classList.toggle("hidden", mode !== "single");
        dom.gridOverlay.classList.toggle("visible", mode === "grid");
        dom.compareOverlay.classList.toggle("visible", mode === "compare");
        dom.diffOverlay.classList.toggle("visible", mode === "diff");
        dom.noVideoMsg.classList.add("hidden");

        // Swap the bottom frame controls depending on mode
        $("#singleSliderWrapper").style.display = mode === "compare" ? "none" : "flex";
        $("#compareSliderWrapper").style.display = mode === "compare" ? "flex" : "none";
        $("#btnPrevFrame").style.visibility = mode === "compare" ? "hidden" : "visible";
        $("#btnNextFrame").style.visibility = mode === "compare" ? "hidden" : "visible";
        $("#frameNum").style.visibility = mode === "compare" ? "hidden" : "visible";

        if (mode === "grid") buildGrid();
        if (mode === "compare") renderCompare();
        if (mode === "diff") renderDiff();
        if (mode === "single") renderFrame(S.currentFrame);
        dom.extractOverlay.classList.toggle("visible", mode === "extract");
        dom.overlapOverlay.classList.toggle("visible", mode === "overlap");
    }

    // ═══════════════════════════════════════
    // MARKERS
    // ═══════════════════════════════════════
    function addMarker() {
        if (S.markers.includes(S.currentFrame)) return;
        S.markers.push(S.currentFrame);
        S.markers.sort((a, b) => a - b);
        try { localStorage.setItem("framelab_markers_" + S.fileName, JSON.stringify(S.markers)); } catch(e){}
        renderMarkers();
    }

    function renderMarkers() {
        dom.markersList.innerHTML = "";
        for (const m of S.markers) {
            const el = document.createElement("div");
            el.className = "marker-item";
            el.innerHTML = `<span><span class="marker-dot"></span>Frame ${m + 1} (${(m / S.fps).toFixed(2)}s)</span><button class="marker-remove" data-f="${m}">✕</button>`;
            el.addEventListener("click", (e) => {
                if (e.target.classList.contains("marker-remove")) {
                    S.markers = S.markers.filter((x) => x !== m);
                    try { localStorage.setItem("framelab_markers_" + S.fileName, JSON.stringify(S.markers)); } catch(ex){}
                    renderMarkers();
                    return;
                }
                S.currentFrame = m;
                setView("single");
            });
            dom.markersList.appendChild(el);
        }
    }

    // ═══════════════════════════════════════
    // EXPORT
    // ═══════════════════════════════════════
    function exportFrame() {
        const tmpCan = document.createElement("canvas");
        tmpCan.width = S.width;
        tmpCan.height = S.height;
        tmpCan.getContext("2d").drawImage(S.video, 0, 0, S.width, S.height);
        const baseName = S.fileName.replace(/\.[^.]+$/, "");
        downloadCanvas(tmpCan, `${baseName}_frame${S.currentFrame + 1}.png`);
    }

    // ===================================
    // FRAME EXTRACT (fream_ext.py)
    // ===================================
    let extractedFrameIdx = -1;

    function extractPreview() {
        if (S.totalFrames === 0) return;
        const timeSec = parseFloat($("#extractTimeSec").value) || 0;
        const frameNum = parseInt($("#extractFrameNum").value) || 1;
        let idx;
        if (timeSec > 0) {
            idx = Math.min(S.totalFrames - 1, Math.max(0, Math.round(timeSec * S.fps)));
            $("#extractFrameNum").value = idx + 1;
        } else {
            idx = Math.min(S.totalFrames - 1, Math.max(0, frameNum - 1));
        }
        extractedFrameIdx = idx;
        seekAndDraw(dom.extractCanvas, idx).then(() => {
            $("#btnExtractDownload").disabled = false;
            dom.statusText.textContent = `Preview: Frame ${idx + 1} at ${(idx / S.fps).toFixed(2)}s`;
        });
    }

    function extractDownload() {
        if (extractedFrameIdx < 0) return;
        const baseName = S.fileName.replace(/\.[^.]+$/, "");
        downloadCanvas(dom.extractCanvas, `${baseName}_frame${extractedFrameIdx + 1}.png`);
    }

    function extractAllMarked() {
        if (S.markers.length === 0) {
            alert("No markers set! Mark frames first using the star button or press M.");
            return;
        }
        let completed = 0;
        const total = S.markers.length;
        let chain = Promise.resolve();
        for (const m of S.markers) {
            chain = chain.then(() => {
                return seekTo(m).then(() => {
                    const c = document.createElement("canvas");
                    c.width = S.width;
                    c.height = S.height;
                    c.getContext("2d").drawImage(S.video, 0, 0, S.width, S.height);
                    const baseName = S.fileName.replace(/\.[^.]+$/, "");
                    downloadCanvas(c, `${baseName}_frame${m + 1}.png`);
                    completed++;
                    dom.statusText.textContent = `Exporting: ${completed}/${total}`;
                });
            });
        }
        chain.then(() => {
            dom.statusText.textContent = `Downloaded ${total} marked frames`;
        });
    }

    function downloadCanvas(canvas, filename) {
        const link = document.createElement("a");
        link.download = filename;
        link.href = canvas.toDataURL("image/png");
        link.click();
    }

    // ===================================
    // FOLDER SUPPORT
    // ===================================
    function loadFolder(videoFileList) {
        S.videoFiles = videoFileList.map((f) => ({ file: f, name: f.name }));
        S.activeVideoIdx = 0;
        dom.videoListPanel.classList.remove("hidden");
        $("#videoCount").textContent = S.videoFiles.length;
        renderVideoList();
        dom.statusText.textContent = `Loaded folder: ${S.videoFiles.length} videos`;
        loadVideo(S.videoFiles[0].file);
    }

    function renderVideoList() {
        dom.videoList.innerHTML = "";
        S.videoFiles.forEach((v, i) => {
            const el = document.createElement("div");
            el.className = "video-item" + (i === S.activeVideoIdx ? " active" : "");
            el.innerHTML = `<span class="vid-icon">🎬</span><span class="vid-name" title="${v.name}">${v.name}</span><span class="vid-status${i === S.activeVideoIdx ? ' loaded' : ''}"> ${i === S.activeVideoIdx ? 'Active' : ''}</span>`;
            el.addEventListener("click", () => switchVideo(i));
            dom.videoList.appendChild(el);
        });
    }

    function switchVideo(idx) {
        if (idx < 0 || idx >= S.videoFiles.length) return;
        S.activeVideoIdx = idx;
        renderVideoList();
        loadVideo(S.videoFiles[idx].file);
    }

    function batchExtract() {
        if (S.videoFiles.length === 0) {
            alert("No folder loaded! Use 'Load Folder' first.");
            return;
        }
        const frameNum = parseInt($("#extractFrameNum").value) || 1;
        const zip = new JSZip();
        const folder = zip.folder(`extracted_frame${frameNum}`);
        let completed = 0;
        const total = S.videoFiles.length;
        
        dom.statusText.textContent = `Batch extracting frame ${frameNum} from ${total} videos...`;
        dom.progressWrapper.classList.add("visible");
        dom.progressBar.style.width = "0%";
		dom.progressWrapper.style.display = "block";

        function processNext(idx) {
            if (idx >= total) {
                zip.generateAsync({ type: "blob" }, (meta) => {
                    dom.progressBar.style.width = `${meta.percent}%`;
                    dom.statusText.textContent = `Zipping: ${meta.percent.toFixed(1)}%`;
                }).then((blob) => {
                    saveAs(blob, `extracted_frame${frameNum}.zip`);
                    dom.statusText.textContent = `✅ Exported ${total} frames as ZIP`;
                    dom.progressWrapper.style.display = "none";
                });
                return;
            }
            const v = S.videoFiles[idx];
            extractFrameFromFile(v.file, frameNum - 1, (canvas) => {
                const baseName = v.name.replace(/\.[^.]+$/, "");
                const dataUrl = canvas.toDataURL("image/png");
                const base64 = dataUrl.split(",")[1];
                folder.file(`${baseName}_frame${frameNum}.png`, base64, { base64: true });
                completed++;
                dom.statusText.textContent = `Batch extract: ${completed}/${total}`;
                dom.progressBar.style.width = `${(completed / total) * 100}%`;
                
                // Yield to main thread
                setTimeout(() => processNext(idx + 1), 10);
            });
        }
        processNext(0);
    }

    function batchOverlap() {
        if (S.videoFiles.length === 0) {
            alert("No folder loaded! Use 'Load Folder' first.");
            return;
        }
        const secStr = $("#overlapSeconds").value.trim();
        const seconds = secStr ? secStr.split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n)) : [1, 2, 3, 4];
        const mode = $("#overlapMode").value;
        const zip = new JSZip();
        const folder = zip.folder(`overlap_${mode}_${seconds.length}frames`);
        let completed = 0;
        const total = S.videoFiles.length;
        
        dom.statusText.textContent = `Batch overlap: ${total} videos at ${seconds.join(",")}s (${mode})...`;
        dom.progressWrapper.style.display = "block";
        dom.progressBar.style.width = "0%";

        function processNext(idx) {
            if (idx >= total) {
                zip.generateAsync({ type: "blob" }, (meta) => {
                    dom.progressBar.style.width = `${meta.percent}%`;
                    dom.statusText.textContent = `Zipping: ${meta.percent.toFixed(1)}%`;
                }).then((blob) => {
                    saveAs(blob, `overlap_${mode}_${seconds.length}frames.zip`);
                    dom.statusText.textContent = `✅ Exported ${total} overlaps as ZIP`;
                    dom.progressWrapper.style.display = "none";
                });
                return;
            }
            const v = S.videoFiles[idx];
            overlapFramesFromFile(v.file, seconds, mode, (canvas) => {
                const baseName = v.name.replace(/\.[^.]+$/, "");
                const dataUrl = canvas.toDataURL("image/png");
                const base64 = dataUrl.split(",")[1];
                folder.file(`${baseName}_overlap.png`, base64, { base64: true });
                completed++;
                dom.statusText.textContent = `Batch overlap: ${completed}/${total}`;
                dom.progressBar.style.width = `${(completed / total) * 100}%`;
                setTimeout(() => processNext(idx + 1), 10);
            });
        }
        processNext(0);
    }

    // Helper: extract a single frame from a video file
    function extractFrameFromFile(file, frameIdx, callback) {
        const url = URL.createObjectURL(file);
        const vid = document.createElement("video");
        vid.muted = true;
        vid.preload = "auto";
        vid.src = url;
        vid.addEventListener("loadedmetadata", () => {
            const fps = 30;
            const totalFrames = Math.round(vid.duration * fps);
            const idx = Math.min(totalFrames - 1, Math.max(0, frameIdx));
            vid.currentTime = idx / fps;
        });
        vid.onseeked = () => {
            const c = document.createElement("canvas");
            c.width = vid.videoWidth;
            c.height = vid.videoHeight;
            c.getContext("2d").drawImage(vid, 0, 0);
            callback(c);
            URL.revokeObjectURL(url);
        };
    }

    // Helper: overlap frames from a video file at given seconds
    function overlapFramesFromFile(file, seconds, mode, callback) {
        const url = URL.createObjectURL(file);
        const vid = document.createElement("video");
        vid.muted = true;
        vid.preload = "auto";
        vid.src = url;
        vid.addEventListener("loadedmetadata", () => {
            const frames = [];
            let secIdx = 0;
            function seekNext() {
                if (secIdx >= seconds.length) {
                    blendAndReturn();
                    return;
                }
                vid.currentTime = Math.min(vid.duration, seconds[secIdx]);
            }
            vid.onseeked = () => {
                const c = document.createElement("canvas");
                c.width = vid.videoWidth;
                c.height = vid.videoHeight;
                c.getContext("2d").drawImage(vid, 0, 0);
                frames.push(c.getContext("2d").getImageData(0, 0, c.width, c.height));
                secIdx++;
                seekNext();
            };
            function blendAndReturn() {
                if (frames.length === 0) return;
                const w = vid.videoWidth;
                const h = vid.videoHeight;
                const out = new ImageData(w, h);
                const len = out.data.length;
                if (mode === "average") {
                    const alpha = 1.0 / frames.length;
                    const accum = new Float32Array(len);
                    for (const f of frames) {
                        for (let i = 0; i < len; i++) accum[i] += f.data[i] * alpha;
                    }
                    for (let i = 0; i < len; i++) out.data[i] = Math.round(accum[i]);
                } else if (mode === "max") {
                    for (let i = 0; i < len; i++) out.data[i] = 0;
                    for (const f of frames) {
                        for (let i = 0; i < len; i += 4) {
                            out.data[i] = Math.max(out.data[i], f.data[i]);
                            out.data[i + 1] = Math.max(out.data[i + 1], f.data[i + 1]);
                            out.data[i + 2] = Math.max(out.data[i + 2], f.data[i + 2]);
                            out.data[i + 3] = 255;
                        }
                    }
                } else if (mode === "min") {
                    for (let i = 0; i < len; i++) out.data[i] = 255;
                    for (const f of frames) {
                        for (let i = 0; i < len; i += 4) {
                            out.data[i] = Math.min(out.data[i], f.data[i]);
                            out.data[i + 1] = Math.min(out.data[i + 1], f.data[i + 1]);
                            out.data[i + 2] = Math.min(out.data[i + 2], f.data[i + 2]);
                            out.data[i + 3] = 255;
                        }
                    }
                } else {
                    const base = frames[0].data;
                    for (let i = 0; i < len; i += 4) {
                        let dr = 0, dg = 0, db = 0;
                        for (let j = 1; j < frames.length; j++) {
                            dr += Math.abs(base[i] - frames[j].data[i]);
                            dg += Math.abs(base[i + 1] - frames[j].data[i + 1]);
                            db += Math.abs(base[i + 2] - frames[j].data[i + 2]);
                        }
                        const n = frames.length - 1 || 1;
                        out.data[i] = Math.min(255, (dr / n) * 3);
                        out.data[i + 1] = Math.min(255, (dg / n) * 3);
                        out.data[i + 2] = Math.min(255, (db / n) * 3);
                        out.data[i + 3] = 255;
                    }
                }
                const rc = document.createElement("canvas");
                rc.width = w;
                rc.height = h;
                rc.getContext("2d").putImageData(out, 0, 0);
                callback(rc);
                URL.revokeObjectURL(url);
            }
            seekNext();
        });
    }

    // ===================================
    // FRAME OVERLAP (vidToImg_overlap.py)
    // ===================================
    function getOverlapIndices() {
        const frameStr = $("#overlapFrameNums").value.trim();
        const secStr = $("#overlapSeconds").value.trim();
        let indices = [];
        if (frameStr) {
            indices = frameStr.split(",").map((s) => {
                const n = parseInt(s.trim()) - 1;
                return Math.max(0, Math.min(S.totalFrames - 1, n));
            }).filter((n) => !isNaN(n));
        } else if (secStr) {
            indices = secStr.split(",").map((s) => {
                const sec = parseFloat(s.trim());
                return Math.max(0, Math.min(S.totalFrames - 1, Math.round(sec * S.fps)));
            }).filter((n) => !isNaN(n));
        }
        return indices;
    }

    function generateOverlap(indices) {
        if (S.totalFrames === 0 || indices.length === 0) return;
        const mode = $("#overlapMode").value;
        dom.statusText.textContent = `Blending ${indices.length} frames (${mode})...`;

        captureFrames(indices).then((frames) => {
            const w = S.width;
            const h = S.height;
            dom.overlapCanvas.width = w;
            dom.overlapCanvas.height = h;
            const ctx = dom.overlapCanvas.getContext("2d");
            const out = ctx.createImageData(w, h);
            const len = out.data.length;

            if (mode === "average") {
                const alpha = 1.0 / frames.length;
                const accum = new Float32Array(len);
                for (const f of frames) {
                    for (let i = 0; i < len; i++) accum[i] += f.data[i] * alpha;
                }
                for (let i = 0; i < len; i++) out.data[i] = Math.min(255, Math.max(0, Math.round(accum[i])));
            } else if (mode === "max") {
                for (let i = 0; i < len; i++) out.data[i] = 0;
                for (const f of frames) {
                    for (let i = 0; i < len; i += 4) {
                        out.data[i] = Math.max(out.data[i], f.data[i]);
                        out.data[i + 1] = Math.max(out.data[i + 1], f.data[i + 1]);
                        out.data[i + 2] = Math.max(out.data[i + 2], f.data[i + 2]);
                        out.data[i + 3] = 255;
                    }
                }
            } else if (mode === "min") {
                for (let i = 0; i < len; i++) out.data[i] = 255;
                for (const f of frames) {
                    for (let i = 0; i < len; i += 4) {
                        out.data[i] = Math.min(out.data[i], f.data[i]);
                        out.data[i + 1] = Math.min(out.data[i + 1], f.data[i + 1]);
                        out.data[i + 2] = Math.min(out.data[i + 2], f.data[i + 2]);
                        out.data[i + 3] = 255;
                    }
                }
            } else if (mode === "diff") {
                const base = frames[0].data;
                for (let i = 0; i < len; i += 4) {
                    let dr = 0, dg = 0, db = 0;
                    for (let j = 1; j < frames.length; j++) {
                        dr += Math.abs(base[i] - frames[j].data[i]);
                        dg += Math.abs(base[i + 1] - frames[j].data[i + 1]);
                        db += Math.abs(base[i + 2] - frames[j].data[i + 2]);
                    }
                    const n = frames.length - 1 || 1;
                    out.data[i] = Math.min(255, (dr / n) * 3);
                    out.data[i + 1] = Math.min(255, (dg / n) * 3);
                    out.data[i + 2] = Math.min(255, (db / n) * 3);
                    out.data[i + 3] = 255;
                }
            }

            ctx.putImageData(out, 0, 0);
            $("#btnOverlapDownload").disabled = false;
            $("#overlapInfo").textContent = `${indices.length} frames blended (${mode})`;
            dom.statusText.textContent = `Overlap: ${indices.length} frames blended using ${mode} mode`;
        });
    }

    // ═══════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════
    function formatTime(s) {
        const m = Math.floor(s / 60);
        const sec = (s % 60).toFixed(2);
        return `${m}:${sec.padStart(5, "0")}`;
    }

    // ═══════════════════════════════════════
    // EVENT BINDINGS
    // ═══════════════════════════════════════
    // Upload
    $("#btnUpload").addEventListener("click", () => dom.fileInput.click());
    dom.fileInput.addEventListener("change", (e) => {
        if (e.target.files[0]) loadVideo(e.target.files[0]);
    });

    // Drag & drop
    dom.dropZone.addEventListener("click", () => dom.fileInput.click());
    dom.dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dom.dropZone.classList.add("dragover");
    });
    dom.dropZone.addEventListener("dragleave", () => dom.dropZone.classList.remove("dragover"));
    dom.dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dom.dropZone.classList.remove("dragover");
        const files = Array.from(e.dataTransfer.files);
        const videos = files.filter(f => /\.(mp4|webm|avi|mkv|mov)$/i.test(f.name));
        if (videos.length > 1) {
            loadFolder(videos);
        } else if (videos.length === 1) {
            loadVideo(videos[0]);
        }
    });

    // Folder upload
    $("#btnUploadFolder").addEventListener("click", () => dom.folderInput.click());
    dom.folderInput.addEventListener("change", (e) => {
        const files = Array.from(e.target.files);
        const videos = files.filter(f => /\.(mp4|webm|avi|mkv|mov)$/i.test(f.name));
        if (videos.length > 0) loadFolder(videos);
    });

    // Frame slider
    dom.frameSlider.addEventListener("input", () => {
        const idx = parseInt(dom.frameSlider.value);
        renderFrame(idx);
    });

    // Playback buttons (sidebar)
    $("#btnPlay").addEventListener("click", togglePlay);
    $("#btnPrev").addEventListener("click", () => { stopPlay(); renderFrame(Math.max(0, S.currentFrame - 1)); });
    $("#btnNext").addEventListener("click", () => { stopPlay(); renderFrame(Math.min(S.totalFrames - 1, S.currentFrame + 1)); });

    // Frame nav buttons (bottom bar)
    $("#btnPrevFrame").addEventListener("click", () => { stopPlay(); renderFrame(Math.max(0, S.currentFrame - 1)); });
    $("#btnNextFrame").addEventListener("click", () => { stopPlay(); renderFrame(Math.min(S.totalFrames - 1, S.currentFrame + 1)); });
    $("#btnSlower").addEventListener("click", () => {
        S.playSpeed = Math.max(0.1, S.playSpeed - 0.25);
        dom.speedBadge.textContent = S.playSpeed.toFixed(2) + "x";
    });
    $("#btnFaster").addEventListener("click", () => {
        S.playSpeed = Math.min(5, S.playSpeed + 0.25);
        dom.speedBadge.textContent = S.playSpeed.toFixed(2) + "x";
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
        if (S.totalFrames === 0) return;
        switch (e.key) {
            case "ArrowLeft": stopPlay(); renderFrame(Math.max(0, S.currentFrame - 1)); break;
            case "ArrowRight": stopPlay(); renderFrame(Math.min(S.totalFrames - 1, S.currentFrame + 1)); break;
            case " ": e.preventDefault(); togglePlay(); break;
            case "Home": renderFrame(0); break;
            case "End": renderFrame(S.totalFrames - 1); break;
            case "m": addMarker(); break;
        }
    });

    // View tabs
    $$(".view-tab").forEach((tab) => {
        tab.addEventListener("click", () => setView(tab.dataset.view));
    });

    if (dom.chkLockFrame) {
        dom.chkLockFrame.addEventListener("change", (e) => {
            try { localStorage.setItem("framelab_lockFrame", e.target.checked); } catch(ex){}
        });
    }

    // Compare sliders
    dom.compSliderA.addEventListener("input", renderCompare);
    dom.compSliderB.addEventListener("input", renderCompare);

    // Export
    $("#btnExport").addEventListener("click", exportFrame);

    // Markers
    $("#btnMark").addEventListener("click", addMarker);

    // Extract features
    $("#btnExtractPreview").addEventListener("click", extractPreview);
    $("#btnExtractDownload").addEventListener("click", extractDownload);
    $("#btnExtractAll").addEventListener("click", extractAllMarked);
    $("#extractTimeSec").addEventListener("change", () => {
        const sec = parseFloat($("#extractTimeSec").value) || 0;
        if (sec > 0 && S.totalFrames > 0) {
            $("#extractFrameNum").value = Math.min(S.totalFrames, Math.round(sec * S.fps) + 1);
        }
    });

    // Overlap features
    $("#btnOverlapGenerate").addEventListener("click", () => {
        const indices = getOverlapIndices();
        if (indices.length === 0) {
            alert("Enter frame numbers or seconds to blend.");
            return;
        }
        generateOverlap(indices);
    });
    $("#btnOverlapMarked").addEventListener("click", () => {
        if (S.markers.length === 0) {
            alert("No markers set! Mark frames first.");
            return;
        }
        generateOverlap(S.markers);
    });
    $("#btnOverlapDownload").addEventListener("click", () => {
        downloadCanvas(dom.overlapCanvas, `overlap_${Date.now()}.png`);
    });

    // Batch operations for folder
    $("#btnBatchExtract").addEventListener("click", batchExtract);
    $("#btnBatchOverlap").addEventListener("click", batchOverlap);
})();
