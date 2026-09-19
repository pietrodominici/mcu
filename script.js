/**
 * Laboratorio Didattico: Moto Circolare Uniforme e Moto Armonico
 * Three.js (r128) + Canvas 2D + Engine Cinematico Sincronizzato
 * Nessun framework, massima fluidità, ottimizzazione 60 FPS
 */

(function () {
  'use strict';

  function waitForThree(callback, maxRetries = 100) {
    if (typeof THREE !== 'undefined') {
      callback();
    } else if (maxRetries > 0) {
      setTimeout(() => waitForThree(callback, maxRetries - 1), 40);
    } else {
      console.error('Three.js non è stato caricato correttamente dal CDN.');
    }
  }

  // ==========================================================================
  // STATO GLOBALE E OROLOGIO UNIFICATO
  // ==========================================================================
  const state = {
    // Parametri fisici impostati da slider
    r: 2.0,            // Raggio orbita / Ampiezza moto armonico [m]
    omega: 1.2,        // Pulsazione angolare [rad/s]
    phi0: 0.0,         // Fase iniziale [rad]

    // Stato orologio e simulazione
    isPlaying: true,
    simTime: 0.0,      // Tempo globale t [s]
    phaseAcc: 0.0,     // Fase accumulata: integrale di omega*dt per garantire continuità senza scatti

    // Istantanei calcolati
    alpha: 0.0,        // Posizione angolare totale alpha = phi0 + phaseAcc
    x: 2.0,            // Posizione lineare proiettata x(t) = r * cos(alpha)
    y: 0.0,            // Posizione verticale y(t) = r * sin(alpha)
    v: 2.4,            // Velocità scalare tangenziale v = omega * r
    ac: 2.88,          // Accelerazione centripeta a_c = omega^2 * r
    T: 5.236,          // Periodo T = 2pi / omega
    f: 0.191,          // Frequenza f = 1 / T
  };

  // Buffer storico per il grafico scorrevole 2D di x(t)
  const chartHistory = [];
  const MAX_CHART_SECONDS = 7.0; // Finestra temporale visibile nel grafico [s]

  // ==========================================================================
  // ELEMENTI DOM E CACHE
  // ==========================================================================
  const dom = {
    clockDisplay: document.getElementById('clock-display'),
    btnPlayPause: document.getElementById('btn-play-pause'),
    labelPlayPause: document.getElementById('label-play-pause'),
    iconPlayPause: document.getElementById('icon-play-pause'),
    btnStep: document.getElementById('btn-step'),
    btnReset: document.getElementById('btn-reset'),

    sliderR: document.getElementById('slider-radius'),
    sliderOmega: document.getElementById('slider-omega'),
    sliderPhi0: document.getElementById('slider-phi0'),

    badgeR: document.getElementById('badge-radius-val'),
    badgeOmega: document.getElementById('badge-omega-val'),
    badgePhi0: document.getElementById('badge-phi0-val'),

    valPeriod: document.getElementById('val-period'),
    valFreq: document.getElementById('val-freq'),
    valVel: document.getElementById('val-vel'),
    valAccel: document.getElementById('val-accel'),
    valPosX: document.getElementById('val-posx'),

    labelV: document.getElementById('label-v'),
    labelAc: document.getElementById('label-ac'),
    labelP: document.getElementById('label-p'),
    labelShadow: document.getElementById('label-shadow'),

    canvasMcu: document.getElementById('canvas-mcu'),
    canvasHarmonic: document.getElementById('canvas-harmonic'),
    canvasGraph: document.getElementById('canvas-graph'),

    viewportMcu: document.getElementById('viewport-mcu-wrap'),
    viewportHarmonic: document.getElementById('viewport-harmonic-wrap'),
    chartContainer: document.getElementById('chart-container'),
  };

  // ==========================================================================
  // AGGIORNAMENTO FISICA & CONTINUITÀ DI FASE
  // ==========================================================================
  function updatePhysics(dt) {
    if (state.isPlaying && dt > 0) {
      state.simTime += dt;
      // Per evitare scatti bruschi quando l'utente muove lo slider di omega,
      // la fase viene integrata per passi infinitesimali: dPhase = omega * dt.
      state.phaseAcc += state.omega * dt;
    }

    // Angolo complessivo
    state.alpha = state.phi0 + state.phaseAcc;

    // Coordinate cartesiane della sfera in orbita (nel piano XY di Three.js)
    state.x = state.r * Math.cos(state.alpha);
    state.y = state.r * Math.sin(state.alpha);

    // Valori cinematici derivati
    state.v = state.omega * state.r;
    state.ac = state.omega * state.omega * state.r;
    state.T = (2 * Math.PI) / state.omega;
    state.f = 1 / state.T;

    // Aggiornamento buffer storico per il grafico scorrevole
    if (state.isPlaying || chartHistory.length === 0) {
      chartHistory.push({ t: state.simTime, x: state.x });
      // Rimuovi punti più vecchi di MAX_CHART_SECONDS rispetto all'istante corrente
      const cutoffTime = state.simTime - MAX_CHART_SECONDS;
      while (chartHistory.length > 2 && chartHistory[0].t < cutoffTime) {
        chartHistory.shift();
      }
    }
  }

  function updateTelemetryUI() {
    if (dom.clockDisplay) {
      dom.clockDisplay.textContent = `t = ${state.simTime.toFixed(2)} s`;
    }
    if (dom.valPeriod) {
      dom.valPeriod.textContent = `${state.T.toFixed(2)} s`;
    }
    if (dom.valFreq) {
      dom.valFreq.textContent = `${state.f.toFixed(2)} Hz`;
    }
    if (dom.valVel) {
      dom.valVel.textContent = `${state.v.toFixed(2)} m/s`;
    }
    if (dom.valAccel) {
      dom.valAccel.textContent = `${state.ac.toFixed(2)} m/s²`;
    }
    if (dom.valPosX) {
      const sign = state.x >= 0 ? '+' : '';
      dom.valPosX.textContent = `${sign}${state.x.toFixed(2)} m`;
    }
  }

  // ==========================================================================
  // MODULO 1: THREE.JS — MOTO CIRCOLARE UNIFORME (MCU)
  // ==========================================================================
  let rendererMcu, sceneMcu, cameraMcu;
  let mcuOrbitRing, mcuSphere, mcuRadiusLine;
  let arrowVel, arrowAccel;
  const tempVecMcu = new THREE.Vector3();
  const tempScreenVec = new THREE.Vector3();

  function initMcuScene() {
    const width = dom.viewportMcu.clientWidth || 400;
    const height = dom.viewportMcu.clientHeight || 380;

    sceneMcu = new THREE.Scene();
    sceneMcu.background = new THREE.Color(0x090b10);

    cameraMcu = new THREE.PerspectiveCamera(40, width / height, 0.1, 50);
    // Posizionamento camera frontale con leggera angolazione prospettica per profondità 3D
    cameraMcu.position.set(0, -0.15, 8.8);
    cameraMcu.lookAt(0, 0, 0);

    rendererMcu = new THREE.WebGLRenderer({
      canvas: dom.canvasMcu,
      antialias: true,
      powerPreference: 'low-power',
    });
    rendererMcu.setSize(width, height, false);
    rendererMcu.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    // Luci soffuse
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    sceneMcu.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 0.9);
    dirLight.position.set(4, 5, 8);
    sceneMcu.add(dirLight);

    // Griglia/Assi cartesiani discreti nel piano XY
    const gridHelper = new THREE.GridHelper(7.0, 14, 0x272c3d, 0x151824);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -0.05;
    sceneMcu.add(gridHelper);

    // Centro / Origine O
    const originGeo = new THREE.SphereGeometry(0.08, 16, 16);
    const originMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
    const originMesh = new THREE.Mesh(originGeo, originMat);
    sceneMcu.add(originMesh);

    // Traiettoria Circolare (Anello sottile)
    const ringGeo = createCircleGeometry(state.r, 64);
    const ringMat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.65,
    });
    mcuOrbitRing = new THREE.LineLoop(ringGeo, ringMat);
    sceneMcu.add(mcuOrbitRing);

    // Sfera orbitante
    const sphereGeo = new THREE.SphereGeometry(0.18, 24, 20);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.2,
      roughness: 0.3,
      emissive: 0xd97706,
      emissiveIntensity: 0.35,
    });
    mcuSphere = new THREE.Mesh(sphereGeo, sphereMat);
    mcuSphere.position.set(state.x, state.y, 0);
    sceneMcu.add(mcuSphere);

    // Linea del raggio vettore r dal centro alla sfera
    const radiusPoints = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(state.x, state.y, 0)];
    const radiusGeo = new THREE.BufferGeometry().setFromPoints(radiusPoints);
    const radiusMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.45,
    });
    mcuRadiusLine = new THREE.Line(radiusGeo, radiusMat);
    sceneMcu.add(mcuRadiusLine);

    // Vettore Velocità tangenziale v (Verde Smeraldo)
    // Direzione iniziale tangente unitaria (-sin(alpha), cos(alpha), 0)
    const initDirV = new THREE.Vector3(-Math.sin(state.alpha), Math.cos(state.alpha), 0).normalize();
    const initLenV = calcClampedArrowLength(state.v, 0.45, 0.5, 2.5);
    arrowVel = new THREE.ArrowHelper(initDirV, mcuSphere.position, initLenV, 0x10b981, 0.25, 0.16);
    sceneMcu.add(arrowVel);

    // Vettore Accelerazione centripeta a_c (Rosso Vivo)
    // Direzione iniziale sempre verso l'origine (-cos(alpha), -sin(alpha), 0)
    const initDirAc = new THREE.Vector3(-Math.cos(state.alpha), -Math.sin(state.alpha), 0).normalize();
    const initLenAc = calcClampedArrowLength(state.ac, 0.3, 0.4, 2.5);
    arrowAccel = new THREE.ArrowHelper(initDirAc, mcuSphere.position, initLenAc, 0xef4444, 0.25, 0.16);
    sceneMcu.add(arrowAccel);
  }

  function updateMcuScene() {
    // Posizione sfera
    mcuSphere.position.set(state.x, state.y, 0);

    // Aggiornamento cerchio orbita se raggio r varia
    updateCircleGeometry(mcuOrbitRing, state.r);

    // Aggiornamento linea raggio dal centro
    const radPositions = mcuRadiusLine.geometry.attributes.position.array;
    radPositions[3] = state.x;
    radPositions[4] = state.y;
    radPositions[5] = 0;
    mcuRadiusLine.geometry.attributes.position.needsUpdate = true;

    // Vettore Velocità tangenziale v (tangente al moto)
    tempVecMcu.set(-Math.sin(state.alpha), Math.cos(state.alpha), 0).normalize();
    arrowVel.position.copy(mcuSphere.position);
    arrowVel.setDirection(tempVecMcu);
    const lenV = calcClampedArrowLength(state.v, 0.45, 0.4, 2.4);
    arrowVel.setLength(lenV, 0.22, 0.14);

    // Vettore Accelerazione centripeta a_c (rivolto al centro)
    tempVecMcu.set(-Math.cos(state.alpha), -Math.sin(state.alpha), 0).normalize();
    arrowAccel.position.copy(mcuSphere.position);
    arrowAccel.setDirection(tempVecMcu);
    const lenAc = calcClampedArrowLength(state.ac, 0.28, 0.35, 2.4);
    arrowAccel.setLength(lenAc, 0.22, 0.14);

    rendererMcu.render(sceneMcu, cameraMcu);

    // Proiezione screen-space delle etichette HTML
    updateScreenLabels();
  }

  function updateScreenLabels() {
    const width = dom.viewportMcu.clientWidth;
    const height = dom.viewportMcu.clientHeight;

    // Etichetta sfera P(t)
    projectToScreen(mcuSphere.position, cameraMcu, width, height, dom.labelP, 0, -18);

    // Etichetta velocità v (posizionata sulla punta della freccia)
    const vTipPos = tempScreenVec.copy(arrowVel.position).addScaledVector(arrowVel.getWorldDirection(new THREE.Vector3()), arrowVel.line.scale.y || 1.0);
    // In ArrowHelper la direzione tip è lungo arrowVel.dir
    vTipPos.copy(arrowVel.position).addScaledVector(
      new THREE.Vector3(-Math.sin(state.alpha), Math.cos(state.alpha), 0).normalize(),
      calcClampedArrowLength(state.v, 0.45, 0.4, 2.4)
    );
    projectToScreen(vTipPos, cameraMcu, width, height, dom.labelV, 10, -5);

    // Etichetta accelerazione a_c (posizionata sulla punta della freccia rossa)
    const acTipPos = tempScreenVec.copy(arrowAccel.position).addScaledVector(
      new THREE.Vector3(-Math.cos(state.alpha), -Math.sin(state.alpha), 0).normalize(),
      calcClampedArrowLength(state.ac, 0.28, 0.35, 2.4)
    );
    projectToScreen(acTipPos, cameraMcu, width, height, dom.labelAc, -10, 10);
  }

  function projectToScreen(worldPos, camera, width, height, elem, offsetX = 0, offsetY = 0) {
    if (!elem) return;
    tempVecMcu.copy(worldPos);
    tempVecMcu.project(camera);

    // Solo se davanti alla telecamera
    if (tempVecMcu.z > 1) {
      elem.style.display = 'none';
      return;
    }

    const xScreen = (tempVecMcu.x * 0.5 + 0.5) * width + offsetX;
    const yScreen = (-tempVecMcu.y * 0.5 + 0.5) * height + offsetY;

    elem.style.display = 'block';
    elem.style.transform = `translate3d(${xScreen.toFixed(1)}px, ${yScreen.toFixed(1)}px, 0)`;
  }

  // ==========================================================================
  // MODULO 2: THREE.JS — PROIEZIONE LINEARE & OMBRA
  // ==========================================================================
  let rendererHarmonic, sceneHarmonic, cameraHarmonic;
  let harmOrbitGuide, harmOrbitSphere, harmShadowSphere;
  let harmProjectionLine, harmAxisLine, harmTickNegR, harmTickPosR, harmTickOrigin;
  const AXIS_Y_OFFSET = -2.8; // Quota verticale dell'asse lineare orizzontale

  function initHarmonicScene() {
    const width = dom.viewportHarmonic.clientWidth || 400;
    const height = dom.viewportHarmonic.clientHeight || 380;

    sceneHarmonic = new THREE.Scene();
    sceneHarmonic.background = new THREE.Color(0x090b10);

    cameraHarmonic = new THREE.PerspectiveCamera(40, width / height, 0.1, 50);
    // Inquadratura centrata che abbraccia sia la circonferenza generatrice (y ~ 0.5) sia la guida dell'asse x
    cameraHarmonic.position.set(0, -0.6, 9.2);
    cameraHarmonic.lookAt(0, -0.6, 0);

    rendererHarmonic = new THREE.WebGLRenderer({
      canvas: dom.canvasHarmonic,
      antialias: true,
      powerPreference: 'low-power',
    });
    rendererHarmonic.setSize(width, height, false);
    rendererHarmonic.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    // Luci
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    sceneHarmonic.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 0.9);
    dirLight.position.set(3, 4, 8);
    sceneHarmonic.add(dirLight);

    // 1. Circonferenza guida generatrice (semi-trasparente)
    const guideGeo = createCircleGeometry(state.r, 64);
    const guideMat = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.35,
    });
    harmOrbitGuide = new THREE.LineLoop(guideGeo, guideMat);
    sceneHarmonic.add(harmOrbitGuide);

    // 2. Sfera orbitante originale (riferimento cinematica circolare)
    const orbitSphereGeo = new THREE.SphereGeometry(0.14, 20, 16);
    const orbitSphereMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8,
    });
    harmOrbitSphere = new THREE.Mesh(orbitSphereGeo, orbitSphereMat);
    harmOrbitSphere.position.set(state.x, state.y, 0);
    sceneHarmonic.add(harmOrbitSphere);

    // 3. Asse orizzontale graduato di oscillazione a quota AXIS_Y_OFFSET
    const axisPoints = [new THREE.Vector3(-3.4, AXIS_Y_OFFSET, 0), new THREE.Vector3(3.4, AXIS_Y_OFFSET, 0)];
    const axisGeo = new THREE.BufferGeometry().setFromPoints(axisPoints);
    const axisMat = new THREE.LineBasicMaterial({ color: 0x475569 });
    harmAxisLine = new THREE.Line(axisGeo, axisMat);
    sceneHarmonic.add(harmAxisLine);

    // Tacche graduate: Origine x=0, -r, +r
    harmTickOrigin = createTickMesh(0, AXIS_Y_OFFSET, 0.25, 0x94a3b8);
    harmTickNegR = createTickMesh(-state.r, AXIS_Y_OFFSET, 0.35, 0xf59e0b);
    harmTickPosR = createTickMesh(state.r, AXIS_Y_OFFSET, 0.35, 0xf59e0b);
    sceneHarmonic.add(harmTickOrigin);
    sceneHarmonic.add(harmTickNegR);
    sceneHarmonic.add(harmTickPosR);

    // 4. Punto "Ombra" sull'asse (Particella Oscillante del Moto Armonico)
    const shadowGeo = new THREE.SphereGeometry(0.2, 24, 20);
    const shadowMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xb45309,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.3,
    });
    harmShadowSphere = new THREE.Mesh(shadowGeo, shadowMat);
    harmShadowSphere.position.set(state.x, AXIS_Y_OFFSET, 0);
    sceneHarmonic.add(harmShadowSphere);

    // 5. Linea tratteggiata di proiezione ortogonale (collega sfera orbitante e ombra)
    const projPoints = [
      new THREE.Vector3(state.x, state.y, 0),
      new THREE.Vector3(state.x, AXIS_Y_OFFSET, 0),
    ];
    const projGeo = new THREE.BufferGeometry().setFromPoints(projPoints);
    const projMat = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      dashSize: 0.14,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.85,
    });
    harmProjectionLine = new THREE.Line(projGeo, projMat);
    harmProjectionLine.computeLineDistances();
    sceneHarmonic.add(harmProjectionLine);
  }

  function createTickMesh(x, y, height, colorHex) {
    const points = [
      new THREE.Vector3(x, y - height / 2, 0),
      new THREE.Vector3(x, y + height / 2, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: colorHex });
    return new THREE.Line(geo, mat);
  }

  function updateHarmonicScene() {
    // Sfera orbitante nel modulo proiezione
    harmOrbitSphere.position.set(state.x, state.y, 0);

    // Sfera ombra oscillante sull'asse
    harmShadowSphere.position.set(state.x, AXIS_Y_OFFSET, 0);

    // Aggiornamento circonferenza guida r
    updateCircleGeometry(harmOrbitGuide, state.r);

    // Aggiornamento tacche -r e +r
    updateTickMesh(harmTickNegR, -state.r, AXIS_Y_OFFSET, 0.35);
    updateTickMesh(harmTickPosR, state.r, AXIS_Y_OFFSET, 0.35);

    // Aggiornamento linea tratteggiata di proiezione
    const projPositions = harmProjectionLine.geometry.attributes.position.array;
    projPositions[0] = state.x;
    projPositions[1] = state.y;
    projPositions[2] = 0;
    projPositions[3] = state.x;
    projPositions[4] = AXIS_Y_OFFSET;
    projPositions[5] = 0;
    harmProjectionLine.geometry.attributes.position.needsUpdate = true;
    harmProjectionLine.computeLineDistances();

    rendererHarmonic.render(sceneHarmonic, cameraHarmonic);

    // Etichetta screen-space dell'ombra
    const width = dom.viewportHarmonic.clientWidth;
    const height = dom.viewportHarmonic.clientHeight;
    projectToScreen(harmShadowSphere.position, cameraHarmonic, width, height, dom.labelShadow, 0, 22);
  }

  function updateTickMesh(lineMesh, x, y, height) {
    const pos = lineMesh.geometry.attributes.position.array;
    pos[0] = x;
    pos[1] = y - height / 2;
    pos[2] = 0;
    pos[3] = x;
    pos[4] = y + height / 2;
    pos[5] = 0;
    lineMesh.geometry.attributes.position.needsUpdate = true;
  }

  // ==========================================================================
  // MODULO 2 (PARTE B): GRAFICO 2D IN TEMPO REALE DI x(t)
  // ==========================================================================
  let ctxGraph = null;

  function initGraph() {
    ctxGraph = dom.canvasGraph.getContext('2d');
    resizeGraphCanvas();
  }

  function resizeGraphCanvas() {
    if (!dom.canvasGraph || !ctxGraph) return;
    const rect = dom.chartContainer.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    dom.canvasGraph.width = rect.width * dpr;
    dom.canvasGraph.height = rect.height * dpr;
  }

  function drawGraph() {
    if (!ctxGraph || chartHistory.length < 2) return;

    const w = dom.canvasGraph.width;
    const h = dom.canvasGraph.height;
    ctxGraph.clearRect(0, 0, w, h);

    const padLeft = 46;
    const padRight = 20;
    const padTop = 18;
    const padBottom = 24;

    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;
    const centerY = padTop + plotH / 2;

    // Scala ampiezza: massima escursione visibile legata a raggio max (3.2m)
    const maxAmplitudeRange = 3.2;
    const scaleY = (plotH / 2) / maxAmplitudeRange;

    // Tempo corrente
    const tCurrent = state.simTime;
    const tMin = tCurrent - MAX_CHART_SECONDS;
    const tMax = tCurrent;

    function timeToX(t) {
      return padLeft + ((t - tMin) / MAX_CHART_SECONDS) * plotW;
    }

    function valToY(val) {
      return centerY - val * scaleY;
    }

    // 1. Griglia di fondo & Linee di riferimento ampiezza
    ctxGraph.lineWidth = 1;

    // Linea zero centrale (asse dei tempi t)
    ctxGraph.strokeStyle = '#272c3d';
    ctxGraph.beginPath();
    ctxGraph.moveTo(padLeft, centerY);
    ctxGraph.lineTo(w - padRight, centerY);
    ctxGraph.stroke();

    // Linee guida ampiezza corrente (+r e -r)
    const yPosR = valToY(state.r);
    const yNegR = valToY(-state.r);

    ctxGraph.strokeStyle = 'rgba(245, 158, 11, 0.25)';
    ctxGraph.setLineDash([4, 4]);

    // +r
    ctxGraph.beginPath();
    ctxGraph.moveTo(padLeft, yPosR);
    ctxGraph.lineTo(w - padRight, yPosR);
    ctxGraph.stroke();

    // -r
    ctxGraph.beginPath();
    ctxGraph.moveTo(padLeft, yNegR);
    ctxGraph.lineTo(w - padRight, yNegR);
    ctxGraph.stroke();

    ctxGraph.setLineDash([]); // Ripristina tratto continuo

    // 2. Etichette assi Y
    ctxGraph.font = '11px ui-monospace, SFMono-Regular, monospace';
    ctxGraph.fillStyle = '#64748b';
    ctxGraph.textAlign = 'right';
    ctxGraph.textBaseline = 'middle';
    ctxGraph.fillText('0 m', padLeft - 8, centerY);

    ctxGraph.fillStyle = '#fbbf24';
    ctxGraph.fillText(`+${state.r.toFixed(1)}`, padLeft - 8, yPosR);
    ctxGraph.fillText(`-${state.r.toFixed(1)}`, padLeft - 8, yNegR);

    // Tacche temporali verticali (intervallo ogni 1 o 2 secondi)
    ctxGraph.strokeStyle = '#181c28';
    ctxGraph.fillStyle = '#475569';
    ctxGraph.textAlign = 'center';
    ctxGraph.textBaseline = 'top';

    const firstSec = Math.ceil(tMin);
    for (let sec = firstSec; sec <= tMax; sec += 1) {
      if (sec % 2 === 0 || MAX_CHART_SECONDS <= 5) {
        const xPos = timeToX(sec);
        if (xPos >= padLeft && xPos <= w - padRight) {
          ctxGraph.beginPath();
          ctxGraph.moveTo(xPos, padTop);
          ctxGraph.lineTo(xPos, padTop + plotH);
          ctxGraph.stroke();
          ctxGraph.fillText(`${sec}s`, xPos, padTop + plotH + 4);
        }
      }
    }

    // 3. Tracciamento dell'onda armonica a coseno registrata
    ctxGraph.beginPath();
    let firstPoint = true;
    for (let i = 0; i < chartHistory.length; i++) {
      const pt = chartHistory[i];
      if (pt.t < tMin) continue;
      const xPixel = timeToX(pt.t);
      const yPixel = valToY(pt.x);

      if (firstPoint) {
        ctxGraph.moveTo(xPixel, yPixel);
        firstPoint = false;
      } else {
        ctxGraph.lineTo(xPixel, yPixel);
      }
    }

    ctxGraph.strokeStyle = '#f59e0b';
    ctxGraph.lineWidth = 2.5;
    ctxGraph.stroke();

    // 4. Cursore istantaneo dorato sulla testa del grafico (t = tCurrent, x = state.x)
    const curX = timeToX(tCurrent);
    const curY = valToY(state.x);

    // Cerchietto esterno bagliore
    ctxGraph.fillStyle = 'rgba(245, 158, 11, 0.25)';
    ctxGraph.beginPath();
    ctxGraph.arc(curX, curY, 8, 0, Math.PI * 2);
    ctxGraph.fill();

    // Cerchietto centrale pieno
    ctxGraph.fillStyle = '#fbbf24';
    ctxGraph.beginPath();
    ctxGraph.arc(curX, curY, 4, 0, Math.PI * 2);
    ctxGraph.fill();

    // Badge valore istantaneo accanto al punto
    ctxGraph.fillStyle = '#f8fafc';
    ctxGraph.font = 'bold 11px ui-monospace, SFMono-Regular, monospace';
    ctxGraph.textAlign = 'right';
    const sign = state.x >= 0 ? '+' : '';
    ctxGraph.fillText(`x: ${sign}${state.x.toFixed(2)}m`, curX - 12, curY - 10);
  }

  // ==========================================================================
  // UTILITY GEOMETRIA THREE.JS
  // ==========================================================================
  function createCircleGeometry(radius, segments) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(radius * Math.cos(theta), radius * Math.sin(theta), 0));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }

  function updateCircleGeometry(lineLoop, radius) {
    const positions = lineLoop.geometry.attributes.position.array;
    const count = positions.length / 3;
    for (let i = 0; i < count; i++) {
      const theta = (i / (count - 1)) * Math.PI * 2;
      positions[i * 3] = radius * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(theta);
      positions[i * 3 + 2] = 0;
    }
    lineLoop.geometry.attributes.position.needsUpdate = true;
  }

  function calcClampedArrowLength(magnitude, scaleFactor, minLen, maxLen) {
    const len = magnitude * scaleFactor;
    return Math.max(minLen, Math.min(len, maxLen));
  }

  // ==========================================================================
  // GESTIONE EVENTI CONTROLLI E SLIDER
  // ==========================================================================
  function bindUIEvents() {
    // 1. Play / Pause
    dom.btnPlayPause.addEventListener('click', () => {
      state.isPlaying = !state.isPlaying;
      if (state.isPlaying) {
        dom.iconPlayPause.textContent = '⏸';
        dom.labelPlayPause.textContent = 'Pausa';
        dom.btnPlayPause.classList.add('btn-primary');
      } else {
        dom.iconPlayPause.textContent = '▶';
        dom.labelPlayPause.textContent = 'Riprendi';
        dom.btnPlayPause.classList.remove('btn-primary');
      }
    });

    // 2. Passo singolo (Step)
    dom.btnStep.addEventListener('click', () => {
      state.isPlaying = false;
      dom.iconPlayPause.textContent = '▶';
      dom.labelPlayPause.textContent = 'Riprendi';
      dom.btnPlayPause.classList.remove('btn-primary');

      // Avanza di dt = 0.04s
      updatePhysics(0.04);
      updateTelemetryUI();
      updateMcuScene();
      updateHarmonicScene();
      drawGraph();
    });

    // 3. Reset (t = 0)
    dom.btnReset.addEventListener('click', () => {
      state.simTime = 0.0;
      state.phaseAcc = 0.0;
      chartHistory.length = 0;

      updatePhysics(0);
      updateTelemetryUI();
      updateMcuScene();
      updateHarmonicScene();
      drawGraph();
    });

    // 4. Slider Raggio / Ampiezza (r)
    dom.sliderR.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.r = val;
      dom.sliderR.setAttribute('aria-valuenow', val.toString());
      dom.badgeR.textContent = `${val.toFixed(2)} m`;

      updatePhysics(0);
      updateTelemetryUI();
      updateMcuScene();
      updateHarmonicScene();
      drawGraph();
    });

    // 5. Slider Pulsazione Angolare (omega)
    // NOTA: Grazie alla conservazione della fase accumulata (phaseAcc),
    // la variazione di omega è fluida, immediata e NON produce salti bruschi di posizione!
    dom.sliderOmega.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.omega = val;
      dom.sliderOmega.setAttribute('aria-valuenow', val.toString());
      dom.badgeOmega.textContent = `${val.toFixed(2)} rad/s`;

      updatePhysics(0);
      updateTelemetryUI();
      updateMcuScene();
      updateHarmonicScene();
      drawGraph();
    });

    // 6. Slider Fase Iniziale (phi0)
    dom.sliderPhi0.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.phi0 = val;
      dom.sliderPhi0.setAttribute('aria-valuenow', val.toString());
      const degrees = Math.round((val * 180) / Math.PI);
      dom.badgePhi0.textContent = `${val.toFixed(2)} rad (${degrees}°)`;

      updatePhysics(0);
      updateTelemetryUI();
      updateMcuScene();
      updateHarmonicScene();
      drawGraph();
    });

    // ResizeObserver su entrambi i contenitori 3D e il grafico 2D
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (dom.viewportMcu) resizeObserver.observe(dom.viewportMcu);
    if (dom.viewportHarmonic) resizeObserver.observe(dom.viewportHarmonic);
    if (dom.chartContainer) resizeObserver.observe(dom.chartContainer);
  }

  function handleResize() {
    // MCU Viewport
    if (rendererMcu && cameraMcu && dom.viewportMcu) {
      const w = dom.viewportMcu.clientWidth;
      const h = dom.viewportMcu.clientHeight;
      if (w > 0 && h > 0) {
        cameraMcu.aspect = w / h;
        cameraMcu.updateProjectionMatrix();
        rendererMcu.setSize(w, h, false);
      }
    }

    // Harmonic Viewport
    if (rendererHarmonic && cameraHarmonic && dom.viewportHarmonic) {
      const w = dom.viewportHarmonic.clientWidth;
      const h = dom.viewportHarmonic.clientHeight;
      if (w > 0 && h > 0) {
        cameraHarmonic.aspect = w / h;
        cameraHarmonic.updateProjectionMatrix();
        rendererHarmonic.setSize(w, h, false);
      }
    }

    // 2D Chart
    resizeGraphCanvas();
    drawGraph();
  }

  // ==========================================================================
  // LOOP DI ANIMAZIONE SINCRONIZZATO (Nativo requestAnimationFrame)
  // ==========================================================================
  let lastTimestamp = performance.now();

  function animate(timestamp) {
    requestAnimationFrame(animate);

    const rawDt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    // Clamp di sicurezza per evitare salti anomali quando la scheda del browser perde il focus
    const dt = Math.min(rawDt, 0.1);

    // 1. Aggiornamento orologio e fisica
    updatePhysics(dt);

    // 2. Aggiornamento telemetria numerica
    updateTelemetryUI();

    // 3. Rendering sincrono del Modulo 1 (MCU)
    updateMcuScene();

    // 4. Rendering sincrono del Modulo 2 (Moto Armonico & Ombra)
    updateHarmonicScene();

    // 5. Disegno del grafico in tempo reale x(t)
    drawGraph();
  }

  // ==========================================================================
  // AVVIO APPLICAZIONE
  // ==========================================================================
  function start() {
    // Inizializza stato iniziale a t=0
    updatePhysics(0);
    updateTelemetryUI();

    // Inizializza moduli
    initMcuScene();
    initHarmonicScene();
    initGraph();

    // Collega interazioni utente
    bindUIEvents();

    // Rendering primo frame
    updateMcuScene();
    updateHarmonicScene();
    drawGraph();

    // Avvio loop globale a 60 FPS
    requestAnimationFrame((t) => {
      lastTimestamp = t;
      animate(t);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForThree(start));
  } else {
    waitForThree(start);
  }
})();
