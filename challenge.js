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
      chapterStars: Array(8).fill(0), muted: false, medals: [], accessories: [], seenPets: 0, seenMedals: 0 }
    try {
      const saved = storage?.read(SAVE_KEY) || {}
      for (const key of ['best', 'saves', 'fastest', 'combo', 'seenPets', 'seenMedals']) {
        if (Number.isSafeInteger(saved[key]) && saved[key] >= 0) record[key] = saved[key]
      }
      if (typeof saved.daily?.date === 'string' && Number.isSafeInteger(saved.daily.ms) && saved.daily.ms > 0) record.daily = saved.daily
      if (Number.isInteger(saved.skin) && SKINS[saved.skin]) record.skin = saved.skin
      if (Array.isArray(saved.chapterStars)) {
        record.chapterStars = record.chapterStars.map((_, index) => {
          const score = saved.chapterStars[index]
          return Number.isInteger(score) && score >= 1 && score <= 3 ? score : 0
        })
      }
      record.muted = saved.muted === true
      if (Array.isArray(saved.medals)) record.medals = [...new Set(saved.medals.filter(value => Number.isInteger(value) && value >= 0 && value < 6))]
      if (Array.isArray(saved.accessories)) record.accessories = [...new Set(saved.accessories.filter(value => record.medals.includes(value)))]
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

  const MEDALS = [
    ['极限脱险', '水位 11 时完成救援', '泳镜'],
    ['五连高手', '一次消除至少五连', '小黄鸭'],
    ['徒手救援', '不用道具通过第 5 轮', '领结'],
    ['救援船长', '无限救援通过第 10 轮', '船长帽'],
    ['章节全通', '通关八个救援章节', '围巾'],
    ['每日全通', '完成同一天的三盘挑战', '星星徽章'],
  ]

  function dailyTasks(storage, changes) {
    const date = dailyDate()
    const key = 'dog-shared-tasks-v1'
    let saved
    try { saved = storage?.read(key) } catch {}
    const variant = Number(date.slice(-2)) % 3
    const goals = [2 + variant, 2 + variant, 3000 + variant * 1000]
    const treats = Number.isSafeInteger(saved?.treats) && saved.treats >= 0 ? saved.treats : 0
    const state = { date, values: [0, 0, 0], treats, claimed: false }
    if (saved?.date === date && Array.isArray(saved.values)) {
      state.values = goals.map((limit, i) => Number.isFinite(saved.values[i]) ? Math.max(0, Math.min(saved.values[i], limit)) : 0)
      state.claimed = saved.claimed === true
    }
    if (changes) {
      const next = goals.map((limit, i) => Math.min(limit, i === 2
        ? Math.max(state.values[i], changes[i] || 0) : state.values[i] + (changes[i] || 0)))
      if (next.some((value, i) => value !== state.values[i])) {
        state.values = next
        if (!state.claimed && next.every((value, i) => value >= goals[i])) {
          state.claimed = true
          state.treats += 2
        }
        try { storage?.write(key, state) } catch {}
      }
    }
    return { ...state, goals }
  }

  function petProgress(storage, rescues) {
    let treats = dailyTasks(storage).treats
    for (const key of ['dog-classic-v1', 'dog-descent-v1']) {
      try {
        const value = storage?.read(key)?.treats
        if (Number.isSafeInteger(value) && value > 0) treats += value
      } catch {}
    }
    return rescues + treats
  }

  const challenge = { dailyDate, dailyRandom, recordStore, grade, UPGRADES, SKINS, MEDALS, dailyTasks, petProgress }
  if (typeof module === 'object') module.exports = challenge
  else globalThis.RescueChallenge = challenge
})()
