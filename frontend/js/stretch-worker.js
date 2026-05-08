// WSOLA time-stretch — runs off the main thread.
// Receives { channels: Float32Array[], rate: number }
// Posts back { channels: Float32Array[] } with transferables.
self.onmessage = function ({ data: { channels, rate } }) {
  const F = 2048, HOP = 1024, SEARCH = 64, CORR = 128;
  const hopOut = Math.max(1, Math.round(HOP / rate));

  const win = new Float32Array(F);
  for (let i = 0; i < F; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / F);

  const outChannels = channels.map(inp => {
    const inLen  = inp.length;
    const outLen = Math.ceil(inLen / rate);
    const outp   = new Float32Array(outLen);
    const norm   = new Float32Array(outLen);
    const prev   = new Float32Array(CORR); // tail of last placed frame

    let inPos = 0, outPos = 0;

    while (inPos + F <= inLen) {
      // Cross-correlate candidate positions with the tail of the previous frame
      // to find the alignment that minimises the discontinuity at the join.
      let delta = 0;
      if (inPos > CORR) {
        let best = -Infinity;
        const lo = Math.max(-inPos, -SEARCH);
        const hi = Math.min(inLen - F - inPos, SEARCH);
        for (let d = lo; d <= hi; d++) {
          let c = 0;
          for (let i = 0; i < CORR; i++) c += prev[i] * inp[inPos + d + i];
          if (c > best) { best = c; delta = d; }
        }
      }

      const src = inPos + delta;
      for (let i = 0; i < F; i++) {
        const oi = outPos + i;
        if (oi >= outLen) break;
        outp[oi] += inp[src + i] * win[i];
        norm[oi] += win[i];
      }

      // Save tail for next iteration
      const tail = src + F - CORR;
      for (let i = 0; i < CORR; i++) prev[i] = inp[tail + i];

      inPos  += HOP;
      outPos += hopOut;
    }

    for (let i = 0; i < outLen; i++)
      if (norm[i] > 1e-6) outp[i] /= norm[i];

    return outp;
  });

  self.postMessage({ channels: outChannels }, outChannels.map(c => c.buffer));
};
