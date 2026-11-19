(function () {
  const SAVE_KEY = 'dog-rescue-record-v1'
  const SKINS = [
    { name: '柯基', after: 0 },
    { name: '柴犬', after: 3, fur: ['#edb361', '#b56942'] },
    { name: '边牧', after: 10, fur: ['#68747a', '#343d46'] },
    { name: '斑点狗', after: 25, fur: ['#f4efe2', '#c6c2b8'] },
    { name: '金毛', after: 40, fur: ['#f0ca76', '#c79643'] },
    { name: '比格犬', after: 55, fur: ['#c79970', '#87583e'] },
    { name: '贵宾犬', after: 75, fur: ['#f3dfbd', '#cbb18f'] },
    { name: '橘猫', after: 100, fur: ['#f7bf7c', '#d28349'] },
  ]
  const UPGRADES = [
    { key: 'bonusCells', title: '高效排水', detail: '每接通 4 格加 2 秒', value: 4 },
    { key: 'gateDelay', title: '加固闸门', detail: '关闸水位延后一级', value: 1 },
    { key: 'longExtra', title: '连消增益', detail: '长连消再加 1 秒', value: 1000 },
    { key: 'reverseFlow', title: '逆流导水', detail: '空槽可向上连通', value: true },
    { key: 'toolCost', title: '快速充能', detail: '工具只需 7 格充能', value: 7 },
    { key: 'doubleCharge', title: '双倍蓄能', detail: '长连消获得双倍工具充能', value: true },
    { key: 'thinPlate', title: '破甲波及', detail: '相邻消除一击拆除铁板', value: true },
    { key: 'supply', title: '应急补给', detail: '下一轮开始时加 3 秒', value: 3000 },
    { key: 'reroll', title: '备用方案', detail: '恢复 1 次换盘', value: 1 },
  ]

  function dailyDate(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  }

  function dailyRandom(date, round) {
    let seed = Number(date.replaceAll('-', '')) * 4 + round
    return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  }

  function recordStore(storage) {
    const record = { best: 0, saves: 0, fastest: 0, combo: 0, daily: null, skin: 0, scores: [],
      chapterStars: Array(8).fill(0), muted: false, medals: [] }
    try {
      const saved = storage?.read(SAVE_KEY) || {}
      for (const key of ['best', 'saves', 'fastest', 'combo']) {
        if (Number.isSafeInteger(saved[key]) && saved[key] >= 0) record[key] = saved[key]
      }
      if (typeof saved.daily?.date === 'string' && Number.isSafeInteger(saved.daily.ms) && saved.daily.ms > 0) record.daily = saved.daily
      if (SKINS[saved.skin] && record.saves >= SKINS[saved.skin].after) record.skin = saved.skin
      if (Array.isArray(saved.chapterStars)) {
        record.chapterStars = record.chapterStars.map((_, index) => {
          const score = saved.chapterStars[index]
          return Number.isInteger(score) && score >= 1 && score <= 3 ? score : 0
        })
      }
      record.muted = saved.muted === true
      if (Array.isArray(saved.medals)) record.medals = [...new Set(saved.medals.filter(value => Number.isInteger(value) && value >= 0 && value < 6))]
      if (Array.isArray(saved.scores)) {
        record.scores = saved.scores.filter(score => Number.isSafeInteger(score) && score > 0)
          .sort((a, b) => b - a).slice(0, 5)
      }
    } catch {}

    function save() {
      try { storage?.write(SAVE_KEY, record) } catch {}
    }

    return { record, save }
  }

  function grade(water, risky, hinted) {
    return 1 + Number(water <= 6) + Number((risky || water <= 3) && !hinted)
  }

  const challenge = { dailyDate, dailyRandom, recordStore, grade, UPGRADES, SKINS }
  if (typeof module === 'object') module.exports = challenge
  else globalThis.RescueChallenge = challenge
})()
