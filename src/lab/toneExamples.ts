import type { CodeProject } from './labCodeProjectSource'

/** All sounds are synthesized locally. Opening an example creates a separate project. */
export const TONE_EXAMPLES: { id: string; label: string; project: CodeProject }[] = [
  { id: 'keys', label: 'Tone · warm keys', project: { osaCode: 1, runtime: 'tone', filename: 'warm-keys.js', language: 'javascript', code: `// Run with Tone.js, then Play sound. Start with a low device volume.
// Edit notes or envelope, then Run again. Sliders update the running sound.
const synth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'triangle' },
  envelope: { attack: 0.02, decay: 0.2, sustain: 0.3, release: 0.9 }
}).connect(lab.output);
const notes = ['C4', 'Eb4', 'G4', 'Bb4', 'G4', 'Eb4'];
new Tone.Sequence((time, note) => {
  synth.triggerAttackRelease(note, '8n', time, 0.35);
}, notes, '8n').start(0);
lab.slider('tempo', { label: 'Tempo · BPM', min: 40, max: 180, value: 90 }, value => {
  Tone.getTransport().bpm.value = value;
});
lab.slider('release', { label: 'Release · seconds', min: 0.05, max: 3, step: 0.05, value: 0.9 }, value => {
  synth.set({ envelope: { release: value } });
});
lab.scope('Synth', synth);
Tone.getTransport().start();
` } },
  { id: 'rhythm', label: 'Tone · rhythm & swing', project: { osaCode: 1, runtime: 'tone', filename: 'rhythm.js', language: 'javascript', code: `// Change the step patterns: 1 plays, 0 rests.
const kick = new Tone.MembraneSynth().connect(lab.output);
const hat = new Tone.NoiseSynth({
  noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.045, sustain: 0 }
}).connect(lab.output);
kick.volume.value = -8;
hat.volume.value = -24;
new Tone.Sequence((time, hit) => {
  if (hit) kick.triggerAttackRelease('C1', '16n', time, 0.5);
}, [1, 0, 0, 1, 0, 0, 1, 0], '8n').start(0);
new Tone.Sequence((time, hit) => {
  if (hit) hat.triggerAttackRelease('32n', time, 0.4);
}, [1, 1, 1, 1, 1, 1, 1, 1], '8n').start(0);
lab.slider('tempo', { label: 'Tempo · BPM', min: 50, max: 180, value: 110 }, value => {
  Tone.getTransport().bpm.value = value;
});
lab.slider('swing', { label: 'Swing', min: 0, max: 0.8, step: 0.01, value: 0.1 }, value => {
  Tone.getTransport().swing = value;
});
lab.scope('Kick', kick);
lab.scope('Hi-hat', hat);
Tone.getTransport().start();
` } },
  { id: 'fm', label: 'Tone · FM timbre', project: { osaCode: 1, runtime: 'tone', filename: 'fm-timbre.js', language: 'javascript', code: `// FM adds sidebands: watch the spectrum as modulation changes.
const synth = new Tone.FMSynth({ harmonicity: 2, modulationIndex: 3 }).connect(lab.output);
synth.volume.value = -10;
new Tone.Loop(time => synth.triggerAttackRelease('C3', '2n', time, 0.4), '1n').start(0);
lab.slider('ratio', { label: 'Harmonicity', min: 0.25, max: 8, step: 0.25, value: 2 }, value => {
  synth.harmonicity.rampTo(value, 0.08);
});
lab.slider('index', { label: 'Modulation index', min: 0, max: 20, step: 0.1, value: 3 }, value => {
  synth.modulationIndex.rampTo(value, 0.08);
});
lab.scope('FM synth', synth);
Tone.getTransport().bpm.value = 90;
Tone.getTransport().start();
` } },
  { id: 'effects', label: 'Tone · filter & delay', project: { osaCode: 1, runtime: 'tone', filename: 'filter-delay.js', language: 'javascript', code: `// Measurement taps branch off the chain; they do not add another audible path.
const synth = new Tone.Synth({ oscillator: { type: 'sawtooth' } });
const filter = new Tone.Filter(1000, 'lowpass');
const delay = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.25, wet: 0.35 });
synth.chain(filter, delay, lab.output);
new Tone.Sequence((time, note) => synth.triggerAttackRelease(note, '16n', time, 0.3),
  ['C3', 'G3', 'Bb3', 'Eb4'], '4n').start(0);
lab.slider('cutoff', { label: 'Low-pass cutoff · Hz', min: 80, max: 8000, step: 20, value: 1000 }, value => {
  filter.frequency.rampTo(value, 0.08);
});
lab.slider('feedback', { label: 'Delay feedback', min: 0, max: 0.7, step: 0.01, value: 0.25 }, value => {
  delay.feedback.rampTo(value, 0.08);
});
lab.slider('wet', { label: 'Delay mix', min: 0, max: 1, step: 0.01, value: 0.35 }, value => {
  delay.wet.rampTo(value, 0.08);
});
lab.scope('Before filter', synth);
lab.scope('After filter', filter);
lab.scope('After delay', delay);
Tone.getTransport().bpm.value = 95;
Tone.getTransport().start();
` } },
  { id: 'convolution', label: 'Tone · convolution / echo taps', project: { osaCode: 1, runtime: 'tone', filename: 'convolution.js', language: 'javascript', code: `// A 1-D kernel (impulse response): weighted, delayed copies of the input.
// Edit these [seconds, weight] pairs, then Run again.
// Three distinct echoes make the convolution easy to hear and inspect.
const taps = [[0, 0.65], [0.18, 0.35], [0.37, 0.2], [0.61, -0.12]];
const rate = Tone.getContext().sampleRate;
const samples = new Float32Array(Math.ceil(rate * 0.8));
for (const [seconds, weight] of taps) samples[Math.round(seconds * rate)] += weight;
const impulse = Tone.ToneAudioBuffer.fromArray(samples);
// Set normalize before buffer; recreate the convolver to change the impulse.
const convolution = new Tone.Convolver({ normalize: false });
convolution.buffer = impulse;
const mix = new Tone.CrossFade(0.7).connect(lab.output);
const synth = new Tone.Synth({ envelope: { attack: 0.005, decay: 0.06, sustain: 0, release: 0.04 } });
synth.connect(mix.a);
synth.connect(convolution);
convolution.connect(mix.b);
new Tone.Loop(time => synth.triggerAttackRelease('C4', '32n', time, 0.4), '1m').start(0);
lab.slider('mix', { label: 'Dry / convolved · equal-power mix', min: 0, max: 1, step: 0.01, value: 0.7 }, value => {
  mix.fade.rampTo(value, 0.08);
});
lab.scope('Before convolution', synth);
lab.scope('Convolved only', convolution);
lab.scope('Mixed result', mix);
Tone.getTransport().bpm.value = 100;
Tone.getTransport().start();
` } },
]
