// AudioWorklet for live voice: batches mic frames (128 samples each) into
// ~85 ms chunks and posts them to the page, which converts them to 16 kHz PCM.
class LiveMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.buf = new Float32Array(this.size);
    this.len = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let i = 0;
      while (i < channel.length) {
        const n = Math.min(channel.length - i, this.size - this.len);
        this.buf.set(channel.subarray(i, i + n), this.len);
        this.len += n;
        i += n;
        if (this.len === this.size) {
          this.port.postMessage(this.buf.slice(0));
          this.len = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("live-mic", LiveMicProcessor);
