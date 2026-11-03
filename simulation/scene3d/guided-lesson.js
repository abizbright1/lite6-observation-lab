// agent: codex | date: 2026-11-03 | inputs: scene3d/scene.js; scene3d/model.js; scene3d/README.md; PHYSICAL_SETUP_AND_DATA_PROTOCOL.md; Lesson 0; Claude Code guided-lesson review
(() => {
  const chapters = [
    {
      title: 'Meet the virtual experiment',
      focus: 'Look at the full 3D environment: Lite6, wrist camera, fixed target and separate reference view.',
      narration: 'You are looking at a three-dimensional computer model of the Lite6 experiment. The camera is attached to the robot wrist. The block stays still on the table. The extra camera is a virtual reference view, not a real measuring instrument. The model helps us see how the parts relate. It does not tell us how accurately your physical camera is calibrated.',
      formula: 'The first experiment has one fixed target, one known flat plane, and one camera mounted on the tool.',
      label: 'VIRTUAL SCENE',
      recipe: { preset: 'clean', speed: 0, delay: 0, bias: 0, noise: 0, targetX: 300, targetY: 0, steps: 0, showTruth: true }
    },
    {
      title: 'Three views of the same moment',
      focus: 'Compare panel 02 (current wrist view), panel 03 (received frame) and panel 05 (virtual reference view).',
      narration: 'Panel two shows the picture from the wrist camera now. Panel three shows the picture delivered to the computer. Panel five shows the scene from a separate virtual viewpoint. In this clean example the arm is stopped, so the current image and the received image match. A displayed reference view is not the same as a calibrated physical reference measurement.',
      formula: 'At this stopped starting point: frame age = 0.00 s. Camera displacement = 0 mm.',
      label: 'SIMULATED · STOPPED',
      recipe: { preset: 'clean', speed: 0, delay: 0, bias: 0, noise: 0, targetX: 300, targetY: 0, steps: 1, showTruth: true }
    },
    {
      title: 'A pixel is not a position',
      focus: 'Read the wrist image and the orange feature in the received image. The small math card uses the target and plane in this virtual scene.',
      narration: 'The image feature is measured in pixels. Pixels are not millimetres. The camera calibration, camera pose and known table plane turn a pixel into a position. In this example, the virtual target is at 290, 20 millimetres on the plane. The rendered feature is about 254, 204 pixels. Project the camera ray through that pixel onto the plane and it returns to about 290, 20 millimetres. This is a geometry demonstration; the feature comes from known scene geometry, not an AI detector.',
      formula: 'Virtual example: (u, v) ≈ (253.8, 203.8) px → plane point (X, Y) ≈ (290.0, 20.0) mm. The plane is Z = 30.5 mm in this viewer.',
      label: 'VIRTUAL · GEOMETRY ORACLE',
      recipe: { preset: 'clean', speed: 0, delay: 0, bias: 0, noise: 0, targetX: 290, targetY: 20, steps: 1, showTruth: true }
    },
    {
      title: 'An old picture can still be right',
      focus: 'The simulation runs to 1.00 s. Watch the exposure time, received-frame age, and unchanged robot.',
      narration: 'Now the camera stays still while the computer waits. The viewer captures a frame every tenth of a simulated second. With a 650 millisecond delivery delay, the frame exposed at 0.30 seconds reaches the computer at 0.95 seconds. At the 1.00 second decision, that image is 0.70 seconds old. But nothing moved, so age alone has not shifted the target position. The time since receipt is only 0.05 seconds.',
      formula: 'Capture-to-decision age = 1.00 − 0.30 = 0.70 s.  Decision minus receipt = 1.00 − 0.95 = 0.05 s.  Camera speed = 0, so motion displacement = 0 mm.',
      label: 'SIMULATED · STATIONARY NULL CASE',
      recipe: { preset: 'delay', speed: 0, delay: 650, bias: 0, noise: 0, targetX: 300, targetY: 0, steps: 10, showTruth: true }
    },
    {
      title: 'An old picture while the arm is moving',
      focus: 'The camera begins over the target. One 100 ms teaching step shows the frame captured at 0.00 s and the arm at 0.10 s.',
      narration: 'Here the arm was already moving when the picture was taken. The image waits 100 milliseconds before it arrives. During that time the wrist camera moves. The estimator combines the old pixels with the current camera pose. Because the tool began directly over the block, the stale estimate now follows the tool and the point check passes. The separate evaluator shows the block is still behind by about six millimetres in X. This is a simulated false approval, not a physical robot result.',
      formula: 'Viewer tick: 0.100 s.  At slider speed 60: phase = (60/35) × 0.100 = 0.17143 rad.  ΔX = 35 sin(0.17143) ≈ 5.97 mm.  ΔY = 18 sin(0.65 × 0.17143) ≈ 1.99 mm.\n\nSeparate hand calculation: if motion were constant at 60 mm/s for 0.030 s, ΔX = 60 × 0.030 = 1.80 mm. The 30 ms example is not a built-in viewer step.',
      label: 'SIMULATED · MOVING CAMERA / OLD FRAME',
      recipe: { preset: 'delay', speed: 60, delay: 100, bias: 0, noise: 0, targetX: 300, targetY: 0, steps: 1, showTruth: true }
    },
    {
      title: 'A fresh picture can still be wrong',
      focus: 'First read the 8 mm mapping-bias example. Use the button to run the virtual alignment sequence in the 3D model.',
      narration: 'This time the frame is fresh and the arm is stopped. The mapping is wrong by eight millimetres in X, so the estimate is 308 while the block is at 300. A new picture does not remove a fixed calibration error. If the virtual arm aligns to the wrong estimate, the point check can pass while the true target is still eight millimetres away. The sequence below only animates the 3D model; it does not contact or control a real robot.',
      formula: 'Assumed virtual bias: +8 mm. At the starting pose: estimate = 308 mm; true target = 300 mm. After alignment to 308 mm: point residual ≈ 0 mm, but true X error ≈ −8 mm.',
      label: 'SIMULATED · CALIBRATION BIAS',
      recipe: { preset: 'bias', speed: 0, delay: 0, bias: 8, noise: 0, targetX: 300, targetY: 0, steps: 1, showTruth: true },
      trial: true
    },
    {
      title: 'How much error can the task accept?',
      focus: 'The viewer uses a square tolerance: each axis must be within 3 mm. The calculation here is an assumed error budget from the study protocol.',
      narration: 'A position estimate is not automatically good enough for a task. The current viewer uses a square rule: X and Y must each be within three millimetres. For practice, assume reference uncertainty of 0.25 millimetres, geometry uncertainty of 0.40, execution uncertainty of 0.30, and eight milliseconds of timing uncertainty at 20 millimetres per second. The timing term is 0.16 millimetres. Adding these assumed per-axis bounds gives 1.11 millimetres. These are teaching assumptions, not readings from your station.',
      formula: 'Timing bound: 20 mm/s × 0.008 s = 0.16 mm.\nAssumed total: 0.25 + 0.40 + 0.30 + 0.16 = 1.11 mm per axis.\n\nMeasured error 1.2 mm: 1.2 + 1.11 = 2.31 mm ≤ 3 → definite pass.\nMeasured error 2.1 mm: interval reaches 3.21 mm → indeterminate.\nMeasured error 4.5 mm: 4.5 − 1.11 = 3.39 mm > 3 → definite fail.',
      label: 'ASSUMED BOUNDS · NOT MEASURED',
      recipe: { preset: 'clean', speed: 0, delay: 0, bias: 0, noise: 0, targetX: 300, targetY: 0, steps: 1, showTruth: true }
    },
    {
      title: 'What you need to learn and collect',
      focus: 'The lesson comes before independent tasks. The current project has synthetic practice data and blank templates for future physical measurements.',
      narration: 'Your next skill is learning to calculate and explain the evidence yourself. Convert milliseconds to seconds. Find image age from decision time minus exposure time. Multiply speed by time only when the robot is already moving. Map pixels through calibration into a named coordinate frame. Compare estimated X and Y with an independent reference, and keep the reference uncertainty visible. The 768-episode batch dataset is synthetic; the real-data templates are blank. Your schedule remains three to four hours each weekday, Monday through Friday, with weekends off.',
      formula: 'For every future real episode, record: image/frame ID; exposure, receipt, detection and decision times with clock domains; robot pose and frame; calibrated pixel feature; independent reference plus uncertainty; method decision; and actual outcome only if a permitted action was executed.\n\nCore calculations: Δt = t_decision − t_exposure.  Δx ≈ v × Δt.  eX = X_est − X_ref.  eY = Y_est − Y_ref.',
      label: 'FUTURE MEASUREMENT CHECKLIST',
      recipe: { preset: 'clean', speed: 0, delay: 0, bias: 0, noise: 0, targetX: 300, targetY: 0, steps: 0, showTruth: false }
    }
  ];

  const byId = id => document.getElementById(id);
  const select = byId('lesson-chapter');
  const readButton = byId('lesson-read');
  const stopButton = byId('lesson-stop');
  const previousButton = byId('lesson-previous');
  const nextButton = byId('lesson-next');
  const trialButton = byId('lesson-trial');
  const status = byId('lesson-status');
  const math = byId('lesson-formula');
  const chaptersNav = byId('lesson-chapter-nav');
  let current = 0;
  let speechRun = 0;
  let chapterRun = 0;
  let paused = false;

  chapters.forEach((chapter, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `${i + 1}. ${chapter.title}`;
    select.appendChild(option);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lesson-dot';
    button.textContent = String(i + 1);
    button.setAttribute('aria-label', `Chapter ${i + 1}: ${chapter.title}`);
    button.addEventListener('click', () => showChapter(i));
    chaptersNav.appendChild(button);
  });

  function splitSentences(text) {
    return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [text];
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      status.textContent = 'Read-aloud is unavailable in this browser. The full explanation remains on screen.';
      return;
    }
    window.speechSynthesis.cancel();
    paused = false;
    readButton.textContent = 'Pause narration';
    const run = ++speechRun;
    const sentences = splitSentences(text);
    const voiceSelect = byId('lesson-voice');
    const voices = window.speechSynthesis.getVoices().filter(v => v.localService && /^en(-|_)/i.test(v.lang));
    const voice = voices.find(v => v.name === voiceSelect.value) || voices[0];
    if (!voice) status.textContent = 'No local English voice is available. You can read the explanation and formulas on screen.';
    else status.textContent = `Reading aloud with ${voice.name}. Use Pause or Stop at any time.`;
    const rate = Number(byId('lesson-rate').value);
    let i = 0;
    const nextSentence = () => {
      if (run !== speechRun || paused || i >= sentences.length) {
        if (run === speechRun && !paused) {
          readButton.textContent = 'Read this explanation aloud';
          status.textContent = 'Explanation complete. You can replay it or choose another chapter.';
        }
        return;
      }
      const sentence = sentences[i++];
      byId('lesson-caption').textContent = sentence;
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.rate = rate;
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'en-US';
      utterance.onend = nextSentence;
      utterance.onerror = nextSentence;
      window.speechSynthesis.speak(utterance);
    };
    nextSentence();
  }

  function stopSpeech() {
    speechRun++;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    paused = false;
    readButton.textContent = 'Read this explanation aloud';
  }

  function setInput(id, value) {
    const input = byId(id);
    if (!input) return;
    const stringValue = String(value);
    if (input.value === stringValue) return;
    input.value = stringValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setCheck(id, checked) {
    const input = byId(id);
    if (!input || input.checked === checked) return;
    input.checked = checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function waitForSimulation() {
    for (let i = 0; i < 300; i++) {
      const api = window.Lite6Experiment;
      if (api && api.stateSnapshot().ready) return api;
      await wait(100);
    }
    throw new Error('The 3D scene did not finish loading. Check the status message above the scene.');
  }

  async function applyRecipe(chapter, isCurrent) {
    const api = await waitForSimulation();
    if (!isCurrent()) return;
    const r = chapter.recipe;
    api.setPreset(r.preset);
    setInput('target-x', r.targetX);
    setInput('target-y', r.targetY);
    setInput('delay-ms', r.delay);
    setInput('bias-mm', r.bias);
    setInput('noise-px', r.noise);
    setInput('motion-speed', r.speed);
    setCheck('show-truth', r.showTruth);
    setCheck('show-frustum', true);
    setCheck('show-reference', true);
    api.reset();
    status.textContent = `Preparing chapter: ${chapter.title}. The 3D scene is simulation only.`;
    for (let i = 0; i < r.steps; i++) {
      byId('step-frame').click();
      await wait(150);
      if (!isCurrent()) return;
    }
    const record = api.stateSnapshot().last_record;
    if (record) showComputedValues(chapter, record);
    else math.textContent = chapter.formula;
  }

  function showComputedValues(chapter, record) {
    const o = record.observation, d = record.decision, truth = record.evaluator_only;
    if (chapter.title === 'Three views of the same moment') {
      math.textContent = `Virtual step: t = ${o.decision_s.toFixed(2)} s. Exposure: ${o.exposure_reported_s.toFixed(2)} s. Age: ${((o.decision_s - o.exposure_reported_s) * 1000).toFixed(0)} ms. Camera speed is 0 mm/s, so displacement is 0 mm.`;
    } else if (chapter.title === 'A pixel is not a position' && d.estimated_target_mm) {
      math.textContent = `Virtual feature: (${o.pixel_u.toFixed(1)}, ${o.pixel_v.toFixed(1)}) px. Inverting the calibrated camera ray onto Z = ${o.known_plane_z_mm.toFixed(1)} mm gives (${d.estimated_target_mm[0].toFixed(1)}, ${d.estimated_target_mm[1].toFixed(1)}) mm in the base frame. The known virtual target is (290, 20) mm.`;
    } else if (chapter.title === 'An old picture can still be right') {
      const receiptAge = o.decision_s - o.host_receipt_s;
      math.textContent = `Decision ${o.decision_s.toFixed(2)} s − exposure ${o.exposure_reported_s.toFixed(2)} s = ${((o.decision_s - o.exposure_reported_s) * 1000).toFixed(0)} ms image age. Time since receipt: ${(receiptAge * 1000).toFixed(0)} ms. The robot and target remained still.`;
    } else if (chapter.title === 'An old picture while the arm is moving') {
      const estimate = d.estimated_target_mm, tool = d.proposed_tool_mm, target = truth.actual_target_mm;
      const dx = estimate[0] - target[0], dy = estimate[1] - target[1];
      const ax = target[0] - tool[0], ay = target[1] - tool[1];
      math.textContent = `Exposure ${o.exposure_reported_s.toFixed(2)} s → decision ${o.decision_s.toFixed(2)} s; age ${((o.decision_s - o.exposure_reported_s) * 1000).toFixed(0)} ms. Virtual estimate error: (${dx.toFixed(2)}, ${dy.toFixed(2)}) mm. True target-to-tool error: (${ax.toFixed(2)}, ${ay.toFixed(2)}) mm. Point test: ${d.approved ? 'passes' : 'withholds'}.${truth.false_approval ? ' This is a simulated false approval.' : ''}`;
    } else if (chapter.title === 'A fresh picture can still be wrong' && d.estimated_target_mm) {
      math.textContent = `Fresh virtual frame at ${o.decision_s.toFixed(2)} s. Estimate: (${d.estimated_target_mm[0].toFixed(1)}, ${d.estimated_target_mm[1].toFixed(1)}) mm. Tool: (${d.proposed_tool_mm[0].toFixed(1)}, ${d.proposed_tool_mm[1].toFixed(1)}) mm. The 8 mm mapping bias remains even with a fresh frame.`;
    } else if (chapter.title === 'How much error can the task accept?') {
      math.textContent = chapter.formula;
    } else {
      math.textContent = chapter.formula;
    }
  }

  async function showChapter(index, { focus = false } = {}) {
    stopSpeech();
    const run = ++chapterRun;
    current = Math.max(0, Math.min(chapters.length - 1, index));
    const chapter = chapters[current];
    select.value = String(current);
    byId('lesson-title').textContent = chapter.title;
    byId('lesson-focus').textContent = chapter.focus;
    byId('lesson-narration').textContent = chapter.narration;
    byId('lesson-label').textContent = chapter.label;
    byId('lesson-caption').textContent = 'Choose “Read this explanation aloud” when you are ready.';
    trialButton.hidden = !chapter.trial;
    chaptersNav.querySelectorAll('.lesson-dot').forEach((button, i) => {
      button.setAttribute('aria-current', i === current ? 'step' : 'false');
    });
    previousButton.disabled = current === 0;
    nextButton.disabled = current === chapters.length - 1;
    try { await applyRecipe(chapter, () => run === chapterRun); }
    catch (error) { status.textContent = error.message; }
    if (run !== chapterRun) return;
    byId('lesson-title').focus({ preventScroll: true });
    if (focus) byId('guided-lesson').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  select.addEventListener('change', () => showChapter(Number(select.value)));
  previousButton.addEventListener('click', () => showChapter(current - 1));
  nextButton.addEventListener('click', () => showChapter(current + 1));
  readButton.addEventListener('click', () => {
    if ('speechSynthesis' in window && window.speechSynthesis.speaking && window.speechSynthesis.paused) {
      window.speechSynthesis.resume(); paused = false; readButton.textContent = 'Pause narration';
      return;
    }
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause(); paused = true; readButton.textContent = 'Continue narration';
      return;
    }
    speak(chapters[current].narration);
  });
  stopButton.addEventListener('click', () => {
    stopSpeech(); byId('lesson-caption').textContent = 'Narration stopped. The written explanation is still here.';
    status.textContent = 'Narration stopped.';
  });
  byId('lesson-rate').addEventListener('input', event => {
    byId('lesson-rate-value').textContent = `${Number(event.target.value).toFixed(2)}×`;
  });
  trialButton.addEventListener('click', () => {
    status.textContent = 'Running the illustrative sequence in the 3D model only. Watch the arm align to the biased estimate; there is no contact or robot command.';
    byId('trial-cycle').click();
    const poll = setInterval(() => {
      const snapshot = window.Lite6Experiment?.stateSnapshot();
      if (!snapshot || snapshot.runtime_error || !snapshot.playing) {
        clearInterval(poll);
        const last = snapshot?.last_record;
        if (last?.evaluator_only?.false_approval) {
          status.textContent = 'The virtual evaluator reports a false approval: the point estimate was aligned, but the target-to-tool error exceeds the simulated ±3 mm X tolerance.';
          math.textContent = `Simulated evaluator result: false approval = true. True target-to-tool error: (${last.evaluator_only.true_error_xy_mm[0].toFixed(1)}, ${last.evaluator_only.true_error_xy_mm[1].toFixed(1)}) mm. No physical action occurred.`;
        } else if (snapshot?.runtime_error) status.textContent = `The 3D simulation paused: ${snapshot.runtime_error}`;
        else status.textContent = 'Virtual sequence ended. Review the evaluator and tool readouts; this is not a physical pick result.';
      }
    }, 200);
  });

  if ('speechSynthesis' in window) {
    const voiceSelect = byId('lesson-voice');
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices().filter(v => v.localService && /^en(-|_)/i.test(v.lang));
      voiceSelect.replaceChildren();
      if (!voices.length) {
        const option = document.createElement('option'); option.textContent = 'No local English voice found'; option.value = '';
        voiceSelect.appendChild(option); return;
      }
      voices.forEach((voice, i) => {
        const option = document.createElement('option'); option.value = voice.name;
        option.textContent = `${voice.name} (${voice.lang})`;
        if (i === 0) option.selected = true;
        voiceSelect.appendChild(option);
      });
    };
    loadVoices(); window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && 'speechSynthesis' in window && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause(); paused = true; readButton.textContent = 'Continue narration';
      status.textContent = 'Narration paused because this tab is hidden. Press Continue when you return.';
    }
  });
  showChapter(0);
})();
