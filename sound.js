(function () {
  const presets = {
    swap: [250],
    clear: [440, 554, 659],
    chain: [554, 659, 830, 988],
    water: [460, 330, 220],
    warn: [330, 260],
    pulse: [150],
    rescue: [660, 830, 988, 1320],
  }

  function soundPlayer(createContext, vibrate) {
    let context
    return {
      unlock() {
        try {
          context ??= createContext?.()
          if (context?.state === 'suspended') context.resume()?.catch?.(() => {})
        } catch {}
      },
      play(event, intensity = 1) {
        if (event === 'chain' || event === 'rescue') {
          try { vibrate?.() } catch {}
        }
        if (!context || context.state !== 'running') return
        const now = context.currentTime
        const notes = presets[event]
        if (!notes) return
        for (let i = 0; i < notes.length; i++) {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          const start = now + i * 0.048
          oscillator.frequency.value = notes[i] * (event === 'chain' ? 1 + Math.max(0, intensity - 1) * 0.07 : 1)
          oscillator.type = event === 'swap' ? 'triangle' : 'sine'
          gain.gain.setValueAtTime(0.0001, start)
          gain.gain.exponentialRampToValueAtTime(0.065, start + 0.008)
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.085)
          oscillator.connect(gain)
          gain.connect(context.destination)
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
          oscillator.start(start)
          oscillator.stop(start + 0.09)
        }
      },
    }
  }

  if (typeof module === 'object') module.exports = { soundPlayer }
  else globalThis.RescueSound = { soundPlayer }
})()
