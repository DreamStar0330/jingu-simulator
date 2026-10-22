/* ==========================================================
 * 金故模拟器 · 游戏状态、回合推进与存档
 * ========================================================== */

const Game = {

  state: null,

  /* ---------- 存档 ---------- */

  save() {
    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.state));
  },

  load() {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.version !== CONFIG.SAVE_VERSION || !Array.isArray(data.cats)) return false;
      this.state = data;
      this.migrate();
      return true;
    } catch (e) {
      return false;
    }
  },

  /** 旧存档迁移：补新字段 + 初始猫改名 + 金币补齐 + 已售出猫补掷命运 */
  migrate() {
    const s = this.state;
    let changed = false;
    if (!Array.isArray(s.log)) { s.log = []; changed = true; }
    if (!Array.isArray(s.soldArchive)) { s.soldArchive = []; changed = true; }
    if (!s.stats || typeof s.stats.born !== 'number') { s.stats = { born: 0 }; changed = true; }
    if (typeof s.stats.deaths !== 'number') { s.stats.deaths = 0; changed = true; }
    if (typeof s.stats.rescued !== 'number') { s.stats.rescued = 0; changed = true; }
    if (typeof s.stats.sold !== 'number') { s.stats.sold = s.soldArchive.length; changed = true; }   // 去新家总数：按名册回填
    if (typeof s.stats.natural !== 'number') { s.stats.natural = 0; changed = true; }   // 寿终正寝数：老存档无从考据，从0计
    if (typeof s.gameOver !== 'boolean') { s.gameOver = false; changed = true; }
    if (typeof s.settled !== 'boolean') { s.settled = false; changed = true; }
    // 第四阶段：旧存档金币直接补到 100000
    if (typeof s.coins !== 'number' || s.coins < CONFIG.START_COINS) { s.coins = CONFIG.START_COINS; changed = true; }
    for (const c of s.cats) {
      if (!('pregnancy' in c)) { c.pregnancy = null; changed = true; }
      if (!('restUntil' in c)) { c.restUntil = null; changed = true; }
    }
    // v1.1：补第10基因座 C（老存档一律视为非点色 C/C），在舍/名册/商场同步
    for (const c of s.cats.concat(s.soldArchive || [], s.market || [])) {
      if (!c || !c.genes) continue;
      if (!Array.isArray(c.genes.C)) { c.genes.C = ['C', 'C']; changed = true; }
    }
    // 初始猫改名：蓝宝 → Dakar，金铃 → nana
    for (const c of s.cats) {
      if (c.name === '蓝宝') { c.name = 'Dakar'; this.log('存档迁移：蓝宝 改名为 Dakar'); changed = true; }
      if (c.name === '金铃') { c.name = 'nana'; this.log('存档迁移：金铃 改名为 nana'); changed = true; }
    }
    // v1.1：初始两只种猫补血统证书（纯展示，不参与遗传）
    for (const c of s.cats) {
      if (!c.pedigree && c.name === 'Dakar') { c.pedigree = '俄罗斯引进 · PKD/PRA NN · 血型NN'; changed = true; }
      if (!c.pedigree && c.name === 'nana')  { c.pedigree = '乌克兰引进 · PKD/PRA NN · 血型NN'; changed = true; }
    }
    // 旧存档没有商场字段：补上并立即刷新一次货架
    if (!Array.isArray(s.market)) { s.market = []; this.refreshMarket(true); changed = true; }
    // 第四阶段：已成交的猫补掷命运轨道（不追溯名声，只影响后续曝光/随访）
    for (const rec of s.soldArchive) {
      if (rec.how === 'adopted') continue;   // 领养退役猫不走命运系统
      if (!rec.fate) {
        rec.fate = this.rollFate(rec);
        rec.fateRevealed = false;
        rec.revealAt = this.fateRevealAt(rec.fate);
        changed = true;
      }
      if (typeof rec.deceased !== 'boolean') { rec.deceased = false; changed = true; }
      if (typeof rec.rescued !== 'boolean') { rec.rescued = false; changed = true; }
      if (!('lastFollowYear' in rec)) { rec.lastFollowYear = null; changed = true; }
      if (typeof rec.strayAsked !== 'boolean') { rec.strayAsked = false; changed = true; }
    }
    // 寿命系统：开局卡标记 / 年度统计 / 后代数回填 / 免费送养记录修正（adopted+fate → free）
    if (typeof s.openingShown !== 'boolean') { s.openingShown = true; changed = true; }   // 老存档不弹开局卡
    if (!s.yearStats) { s.yearStats = { born: 0, sold: 0, died: 0 }; changed = true; }
    if (!Array.isArray(s.memorial)) { s.memorial = []; changed = true; }   // 纪念册（迁移前离世的猫无从考据）
    let needOff = false;
    for (const c of s.cats.concat(s.soldArchive)) {
      if (typeof c.offspring !== 'number') { needOff = true; break; }
    }
    if (needOff) {
      const all = s.cats.concat(s.soldArchive);
      for (const c of all) c.offspring = 0;
      for (const k of all) {
        if (k.sire) { const p = all.find(x => x.id === k.sire); if (p) p.offspring++; }
        if (k.dam)  { const p = all.find(x => x.id === k.dam);  if (p) p.offspring++; }
      }
      changed = true;
    }
    for (const rec of s.soldArchive) {
      if (rec.how === 'adopted' && rec.fate) { rec.how = 'free'; changed = true; }   // 免费送养应走命运+随访
    }
    if (changed) this.save();
  },

  /* ---------- 开局 ---------- */

  newGame() {
    const state = {
      version: CONFIG.SAVE_VERSION,
      month: 0,                       // 绝对月份，0 = 第1年1月
      coins: CONFIG.START_COINS,
      energy: CONFIG.ENERGY_MAX,
      fame: CONFIG.START_FAME,
      cats: [],
      nextCatId: 1,
      log: [],                        // 新事件在前
      market: [],                     // 外部商场当前货架
      soldArchive: [],                // 已售出名册（含出售/转让/领养去向，供后续售后随访）
      memorial: [],                   // 纪念册：所有离世猫 { name, ageText, diedAt }，最新在前
      gameOver: false,                // 破产结局
      settled: false,                 // 70年结算完成
      stats: { born: 0, deaths: 0, rescued: 0, sold: 0, natural: 0 },   // 成活繁育 / 善终 / 救助 / 去新家 / 寿终正寝
      yearStats: { born: 0, sold: 0, died: 0 },    // 年度统计（每年12月弹卡后清零）
      openingShown: false,               // 开局卡是否已显示（每个新存档仅首次）
    };
    this.state = state;

    /* 开局两只1岁整成猫（birth = -12：开局前12个月出生）
     * Dakar：公 · 金渐层 ny11（A_ ii B_ Dd ll，C/cs 重点色携带者），俄罗斯引进
     * nana ：母 · 蓝金渐层 ay11（A_ ii BB dd ll），乌克兰引进，顶流体质
     */
    Cat.create(state, {
      name: 'Dakar', sex: 'M', birth: -12, gradient: 65,
      genes: {
        B: ['B', 'B'], D: ['D', 'd'], A: ['A', 'A'], I: ['i', 'i'], C: ['C', 'cs'],
        O: ['o'], S: ['s', 's'], L: ['l', 'l'], Fd: ['fd', 'fd'], M: ['m', 'm'],
      },
      personality: ['粘人', '安静'], star: false,
      pedigree: '俄罗斯引进 · PKD/PRA NN · 血型NN',
    });
    Cat.create(state, {
      name: 'nana', sex: 'F', birth: -12, gradient: 65,
      genes: {
        B: ['B', 'B'], D: ['d', 'd'], A: ['A', 'A'], I: ['i', 'i'], C: ['C', 'C'],
        O: ['o', 'o'], S: ['s', 's'], L: ['l', 'l'], Fd: ['fd', 'fd'], M: ['m', 'm'],
      },
      personality: ['温柔', '好奇'], star: true,
      pedigree: '乌克兰引进 · PKD/PRA NN · 血型NN',
    });

    this.log('猫舍开业了！Dakar 和 nana 正式入住');
    this.refreshMarket(true);
    this.save();
  },

  restart() {
    localStorage.removeItem(CONFIG.SAVE_KEY);
    this.newGame();
  },

  /* ---------- 日志 ---------- */

  log(text) {
    this.state.log.unshift({ month: this.state.month, text });
    if (this.state.log.length > CONFIG.LOG_MAX) {
      this.state.log.length = CONFIG.LOG_MAX;
    }
  },

  /* ---------- 外部商场 ---------- */

  /** 按名声决定品控层级：名声<30 全纯色；30-70 三成渐层；>70 三成稀有色+三成渐层+四成纯色 */
  rollMarketTier(fame) {
    const r = Math.random();
    if (fame > 70) {
      if (r < 0.30) return 'rare';
      if (r < 0.60) return 'gradient';
      return 'solid';
    }
    if (fame >= 30) return r < 0.30 ? 'gradient' : 'solid';
    return 'solid';
  },

  /** 小猫栏位占用数：月龄 < 12 的在舍猫 */
  juvenileCount() {
    return this.state.cats.filter(c => Cat.ageMonths(c, this.state.month) < 12).length;
  },

  /** 商场每月1日刷新 1-3 只猫 */
  refreshMarket(silent) {
    const s = this.state;
    if (s.gameOver) return;
    const count = MARKET.COUNT_MIN + Math.floor(Math.random() * (MARKET.COUNT_MAX - MARKET.COUNT_MIN + 1));
    s.market = [];
    const usedNames = new Set(s.cats.map(c => c.name));
    for (let i = 0; i < count; i++) {
      const tier = this.rollMarketTier(s.fame);
      const sex = Math.random() < 0.5 ? 'M' : 'F';
      const age = MARKET.AGE_MIN + Math.floor(Math.random() * (MARKET.AGE_MAX - MARKET.AGE_MIN + 1));
      const gradient = tier === 'solid'
        ? 0
        : MARKET.GRADIENT_MIN + Math.floor(Math.random() * (MARKET.GRADIENT_MAX - MARKET.GRADIENT_MIN + 1));
      const used = new Set([...usedNames, ...s.market.map(m => m.name)]);
      const free = CAT_NAME_POOL.filter(n => !used.has(n));
      const pool = free.length ? free : CAT_NAME_POOL;
      s.market.push({
        id: 'mkt_' + s.month + '_' + i,
        name: pool[Math.floor(Math.random() * pool.length)],
        sex: sex,
        birth: s.month - age,
        genes: Genetics.randomMarketGenes(tier, sex),
        gradient: gradient,
        personality: Cat.randomPersonality(1),
        star: Math.random() < MARKET.STAR_RATE,
        health: '健康',
        sire: null,
        dam: null,
        pregnancy: null,
        restUntil: null,
      });
    }
    if (!silent) this.log('🛒 商场到货 ' + count + ' 只新猫，去看看吧');
  },

  /* ---------- 出售定价 ----------
   * 估价 = 2000 × 花色 × (渐层度) × (0.5+名声/100) × 健康 × 月龄 × 性格 × 顶流 × 加白 × 毛长
   */
  priceOf(cat) {
    const s = this.state;
    const coat = Genetics.coat(cat);

    // 花色系数：金渐层按代码查（ny 系分档，ay/cy/by/oy/py 不分档），银渐层1.5，红系1.3，纯色1.0
    let colorMult = PRICE.SOLID;
    if (coat.series === 'silver') colorMult = PRICE.SILVER;
    else if (coat.series === 'golden') {
      colorMult = PRICE.GOLDEN[coat.code] || PRICE.GOLDEN[coat.code.slice(0, 2)] || PRICE.SOLID;
    } else if (coat.series === 'red') colorMult = PRICE.RED;

    let price = PRICE.BASE * colorMult;
    if (coat.isGradient) price *= 1 + cat.gradient / 100;          // 渐层度加成
    price *= 0.5 + s.fame / 100;                                   // 名声系数
    if (cat.health === '畸形') price *= PRICE.DEFORM_MULT;         // 畸形
    else if (cat.health !== '健康') price *= PRICE.BAD_GENE_MULT;  // 折耳/短腿
    if (Cat.ageMonths(cat, s.month) > 12) price *= PRICE.OLD_AGE_MULT;  // 超龄折扣
    if (cat.personality.some(p => PRICE.GOOD_PERSONALITY.includes(p))) {
      price *= PRICE.GOOD_PERSONALITY_MULT;                        // 好性格加成
    }
    if (cat.star) price *= PRICE.STAR_MULT;                        // 顶流体质
    if (coat.name.includes('加白')) price *= PRICE.WHITE_MULT;     // 加白
    if (!coat.longhair) price *= PRICE.SHORTHAIR_MULT;             // 短毛折扣

    return Math.round(price);
  },

  /** 商场买价 = 估价 × 1.2 */
  marketPriceOf(mktCat) {
    return Math.round(this.priceOf(mktCat) * MARKET.PRICE_MULT);
  },

  /** 从商场买猫：扣金币、小猫栏位校验、转入猫舍并重新分配 id */
  buyMarketCat(mktId) {
    const s = this.state;
    if (s.gameOver) return { ok: false, reason: '游戏已结束' };
    const idx = s.market.findIndex(m => m.id === mktId);
    if (idx < 0) return { ok: false, reason: '这只猫已经不在货架上了' };
    const mkt = s.market[idx];
    const price = this.marketPriceOf(mkt);
    if (s.coins < price) return { ok: false, reason: '金币不足' };
    if (this.juvenileCount() >= MARKET.JUVENILE_SLOTS) {
      return { ok: false, reason: '小猫栏位已满（' + MARKET.JUVENILE_SLOTS + ' 只）' };
    }

    s.coins -= price;
    const copy = JSON.parse(JSON.stringify(mkt));
    copy.id = 'cat_' + String(s.nextCatId).padStart(4, '0');
    s.nextCatId += 1;
    s.cats.push(copy);
    s.market.splice(idx, 1);
    this.log('从商场接回了 ' + copy.name + '，花费 ' + price + ' 金币');
    this.save();
    return { ok: true, price: price };
  },

  /* ---------- 出售与退役 ---------- */

  /** 出售在舍猫：满6月、未退役、未怀孕；带病出售扣名声；完整数据转入已售出名册
   *  opts.fanPrice / opts.fanFate：粉丝高价求购渠道（成交价 ×2、专用命运轨道）
   */
  sellCat(id, opts) {
    const s = this.state;
    if (s.gameOver) return { ok: false, reason: '游戏已结束' };
    const cat = s.cats.find(c => c.id === id);
    if (!cat) return { ok: false, reason: '找不到这只猫' };
    const age = Cat.ageMonths(cat, s.month);
    if (age < PRICE.MIN_SELL_AGE) return { ok: false, reason: '未满6个月不能出售' };
    if (age >= RETIRE.AGE) return { ok: false, reason: '已退役，请选择养老安排' };
    if (cat.pregnancy) return { ok: false, reason: '怀孕中不能出售' };

    const fan = !!(opts && opts.fanPrice);
    const price = fan ? opts.fanPrice : this.priceOf(cat);
    s.coins += price;
    if (cat.health !== '健康') {
      s.fame = Math.max(0, Math.min(100, s.fame + PRICE.BAD_HEALTH_FAME));
      this.log(cat.name + ' 特殊基因出售，名声 ' + PRICE.BAD_HEALTH_FAME);
    }
    s.cats = s.cats.filter(c => c.id !== id);
    const record = Object.assign(JSON.parse(JSON.stringify(cat)), {
      how: 'sold', price: price, soldAt: s.month,
    });
    this.assignFate(record, false, fan ? opts.fanFate : null);   // 成交瞬间掷定命运（玩家不可见）
    s.soldArchive.push(record);
    s.yearStats.sold++;
    s.stats.sold++;
    this.log(fan
      ? cat.name + ' 被一位粉丝以 ' + price + ' 金币接走'
      : cat.name + ' 被客人相中，以 ' + price + ' 金币成交');
    this.save();
    return { ok: true, price: price };
  },

  /** 退役猫离舍（how：'transfer' 低价转让 | 'adopted' 免费领养） */
  retireOut(id, how) {
    const s = this.state;
    if (s.gameOver) return { ok: false, reason: '游戏已结束' };
    const cat = s.cats.find(c => c.id === id);
    if (!cat) return { ok: false, reason: '找不到这只猫' };
    if (Cat.ageMonths(cat, s.month) < RETIRE.AGE) return { ok: false, reason: '尚未退役' };

    cat.pregnancy = null;   // 离舍则怀孕作废
    const record = Object.assign(JSON.parse(JSON.stringify(cat)), { how: how });

    if (how === 'transfer') {
      s.coins += RETIRE.TRANSFER_PRICE;
      record.price = RETIRE.TRANSFER_PRICE;
      record.soldAt = s.month;
      this.assignFate(record);        // 低价转让同样走命运系统
      this.log(cat.name + ' 低价转让给靠谱新家，收回 ' + RETIRE.TRANSFER_PRICE + ' 金币');
    } else {
      s.fame = Math.max(0, Math.min(100, s.fame + RETIRE.ADOPT_FAME));
      record.adoptedAt = s.month;
      this.log(cat.name + ' 免费领养去了新家，名声 +' + RETIRE.ADOPT_FAME);
    }

    s.cats = s.cats.filter(c => c.id !== id);
    s.soldArchive.push(record);
    s.yearStats.sold++;
    s.stats.sold++;
    this.save();
    return { ok: true };
  },

  transferRetiredCat(id) { return this.retireOut(id, 'transfer'); },
  adoptRetiredCat(id)    { return this.retireOut(id, 'adopted'); },

  /** 免费送养在舍猫（0金币、名声+1）：条件同出售；命运固定 80%正常/20%百万 */
  adoptFreeCat(id) {
    const s = this.state;
    if (s.gameOver || s.settled) return { ok: false, reason: '游戏已结束' };
    const cat = s.cats.find(c => c.id === id);
    if (!cat) return { ok: false, reason: '找不到这只猫' };
    const age = Cat.ageMonths(cat, s.month);
    if (age < PRICE.MIN_SELL_AGE) return { ok: false, reason: '未满6个月不能送养' };
    if (age >= RETIRE.AGE) return { ok: false, reason: '已退役，请选择养老安排' };
    if (cat.pregnancy) return { ok: false, reason: '怀孕中不能送养' };

    s.fame = Math.max(0, Math.min(100, s.fame + FATE.ADOPT_FAME));
    s.cats = s.cats.filter(c => c.id !== id);
    const record = Object.assign(JSON.parse(JSON.stringify(cat)), {
      how: 'free', price: 0, soldAt: s.month,
    });
    this.assignFate(record, true);    // 送养专用轨道：80%正常家庭/20%百万富翁
    s.soldArchive.push(record);
    s.yearStats.sold++;
    s.stats.sold++;
    this.log(cat.name + ' 免费送养去了好人家，名声 +' + FATE.ADOPT_FAME);
    this.save();
    return { ok: true };
  },

  /* ---------- 售出猫命运系统 ---------- */

  /** 成交瞬间掷定命运轨道（玩家不可见）。顶流直播轨道40%；名声<30坏轨道翻倍，差额从正常份额扣 */
  rollFate(cat) {
    const s = this.state;
    const w = Object.assign({}, FATE.WEIGHTS);
    if (cat.star) w.stream = FATE.STAR_STREAM;
    if (s.fame < FATE.LOW_FAME_LINE) {
      for (const k of ['stream', 'abandoned', 'resold', 'dark']) w[k] *= 2;
    }
    const others = w.rich + w.stream + w.abandoned + w.resold + w.dark;
    w.normal = Math.max(0, 1 - others);
    let r = Math.random();
    for (const k of ['rich', 'stream', 'abandoned', 'resold', 'dark']) {
      r -= w[k];
      if (r < 0) return k;
    }
    return 'normal';
  },

  /** 免费送养专用轨道：20%百万富翁、80%正常家庭，无坏轨道与黑暗结局 */
  rollAdoptFate() {
    return Math.random() < FATE.ADOPT_RICH_RATE ? 'rich' : 'normal';
  },

  /** 粉丝高价求购专用轨道：直播机器50%、百万20%、正常20%、抛弃5%、转卖3%、黑暗2% */
  rollFanFate() {
    const w = FANS.WEIGHTS;
    let r = Math.random();
    for (const k of ['stream', 'rich', 'normal', 'abandoned', 'resold', 'dark']) {
      r -= w[k];
      if (r < 0) return k;
    }
    return 'normal';
  },

  /** 粉丝高价求购：舍内有满6月龄、未退役、未怀孕的顶流猫时 5% 触发，多只随机取一只 */
  rollFanOffer() {
    const s = this.state;
    const pool = s.cats.filter(c =>
      c.star &&
      Cat.ageMonths(c, s.month) >= PRICE.MIN_SELL_AGE &&
      !Cat.isRetired(c, s.month) &&
      !c.pregnancy);
    if (!pool.length) return null;
    if (Math.random() >= FANS.CHANCE) return null;
    const cat = pool[Math.floor(Math.random() * pool.length)];
    return { cat: cat, price: this.priceOf(cat) * FANS.PRICE_MULT };
  },

  /** 粉丝渠道成交：售价 ×2、固定命运轨道，其余流程与正常出售一致 */
  sellToFan(id, price) {
    return this.sellCat(id, { fanPrice: price, fanFate: this.rollFanFate() });
  },

  /** 曝光时点：黑暗 6-18 月，百万 3-12 月，其余不曝光（null） */
  fateRevealAt(fate) {
    const s = this.state;
    if (fate === 'dark') return s.month + FATE.DARK_REVEAL_MIN + Math.floor(Math.random() * FATE.DARK_REVEAL_SPAN);
    if (fate === 'rich') return s.month + FATE.RICH_REVEAL_MIN + Math.floor(Math.random() * FATE.RICH_REVEAL_SPAN);
    return null;
  },

  /** 成交时调用：为档案记录掷命运并立即结算成交名声；adoptMode=免费送养专用轨道，fateOverride=指定轨道 */
  assignFate(record, adoptMode, fateOverride) {
    const s = this.state;
    const fate = fateOverride || (adoptMode ? this.rollAdoptFate() : this.rollFate(record));
    record.fate = fate;
    record.fateRevealed = false;
    record.revealAt = this.fateRevealAt(fate);
    record.deceased = false;
    record.rescued = false;
    record.lastFollowYear = null;
    record.strayAsked = false;
    const df = FATE.FAME[fate];
    if (df) s.fame = Math.max(0, Math.min(100, s.fame + df));
    return fate;
  },

  /** 命运曝光检查：到期的黑暗/百万轨道弹卡，返回事件数组 */
  checkFateReveals() {
    const s = this.state;
    const events = [];
    for (const rec of s.soldArchive) {
      if (rec.how === 'adopted' || rec.deceased || rec.rescued || rec.fateRevealed) continue;
      if (!rec.revealAt || s.month < rec.revealAt) continue;
      rec.fateRevealed = true;
      if (rec.fate === 'dark') {
        s.fame = Math.max(0, Math.min(100, s.fame + FATE.DARK_REVEAL_FAME));
        this.log('有网友爆料，从你猫舍售出的 ' + rec.name + ' 遭遇不幸，帖子已经传开了，名声 ' + FATE.DARK_REVEAL_FAME);
        events.push({ type: 'dark', rec: rec });
      } else if (rec.fate === 'rich') {
        this.log('有人拍到 ' + rec.name + ' 住进了带花园的大房子，网友都说它投了个好胎');
        events.push({ type: 'rich', rec: rec });
      }
    }
    return events;
  },

  /** 年度随访：每月每只 1/12 概率、每年最多1次；流浪求救/主人失联（日常来信由大事记接管，死亡由寿命系统接管） */
  checkFollowups() {
    const s = this.state;
    const events = [];
    const year = Math.floor(s.month / 12);
    for (const rec of s.soldArchive) {
      if (rec.how === 'adopted' || rec.deceased || rec.rescued) continue;
      if (rec.lastFollowYear === year) continue;
      if (Math.random() >= FATE.FOLLOWUP_CHANCE) continue;
      rec.lastFollowYear = year;

      const badTrack = rec.fate === 'stream' || rec.fate === 'abandoned' || rec.fate === 'resold' || rec.fate === 'dark';
      if (badTrack && Math.random() < FATE.BAD_EVENT_RATE) {
        if (Math.random() < FATE.STRAY_RATE && !rec.strayAsked) {
          rec.strayAsked = true;
          events.push({ type: 'stray', rec: rec });
        } else {
          this.log(rec.name + ' 的主人失联了，它的近况无人知晓');
        }
      }
      // 好轨道的日常来信已由每月大事记接管
    }
    return events;
  },

  /** 流浪求救：花3000金币救回猫舍（保留年龄和基因），名声+5 */
  rescueCat(rec) {
    const s = this.state;
    if (s.gameOver || s.settled) return { ok: false, reason: '游戏已结束' };
    const idx = s.soldArchive.indexOf(rec);
    if (idx < 0) return { ok: false, reason: '档案不存在' };
    if (rec.rescued) return { ok: false, reason: '已经救回来了' };
    if (s.coins < FATE.RESCUE_COST) return { ok: false, reason: '金币不足' };

    s.coins -= FATE.RESCUE_COST;
    s.fame = Math.max(0, Math.min(100, s.fame + FATE.RESCUE_FAME));
    // 完整数据回猫舍：剥离档案字段，重新分配 id
    const data = JSON.parse(JSON.stringify(rec));
    for (const k of ['how', 'price', 'soldAt', 'adoptedAt', 'fate', 'fateRevealed', 'revealAt', 'deceased', 'rescued', 'lastFollowYear', 'strayAsked']) {
      delete data[k];
    }
    data.id = 'cat_' + String(s.nextCatId).padStart(4, '0');
    s.nextCatId += 1;
    data.pregnancy = null;
    data.restUntil = null;
    s.cats.push(data);
    rec.rescued = true;
    s.stats.rescued += 1;
    this.log('你花 ' + FATE.RESCUE_COST + ' 金币把 ' + data.name + ' 救了回来，名声 +' + FATE.RESCUE_FAME);
    this.save();
    return { ok: true, cat: data };
  },

  /** 流浪求救：不救。30% 被扒出来源名声-5，70% 无事发生 */
  declineRescue(rec) {
    const s = this.state;
    if (Math.random() < FATE.STRAY_EXPOSE_RATE) {
      s.fame = Math.max(0, Math.min(100, s.fame + FATE.STRAY_EXPOSE_FAME));
      this.log('有人扒出流浪的 ' + rec.name + ' 出自你的猫舍，名声 ' + FATE.STRAY_EXPOSE_FAME);
    }
    this.save();
  },

  /* ---------- 闯祸事件 ---------- */

  /** 加权抽取：cats 数组按 weightFn 加权 */
  _weightedPick(cats, weightFn) {
    let total = 0;
    const ws = cats.map(c => { const w = weightFn(c); total += w; return w; });
    let r = Math.random() * total;
    for (let i = 0; i < cats.length; i++) { r -= ws[i]; if (r < 0) return cats[i]; }
    return cats[cats.length - 1];
  },

  /** 闯祸文案生成（ABCD句式）：纯生成，不含概率与日志，供每月大事记调用
   *  A=肇事猫（捣蛋鬼×3/顶流×2/佛系×0.5），B=地点，C=与A性格匹配的事件，D=背锅猫（幼年/胆小/社恐加权，≠A）
   *  句式50%："A在B C"；50%："A在B C，把D吓得钻进了沙发底"
   */
  rollMischiefText() {
    const s = this.state;
    if (s.cats.length < 2) return null;

    const a = this._weightedPick(s.cats, c =>
      (c.personality.includes('捣蛋鬼') ? 3 : 1) *
      (c.personality.includes('佛系') ? 0.5 : 1) *
      (c.star ? 2 : 1));
    const others = s.cats.filter(c => c !== a);
    const d = this._weightedPick(others, c =>
      (Cat.isJuvenile(c, s.month) ? 2 : 1) *
      ((c.personality.includes('胆小') || c.personality.includes('社恐')) ? 3 : 1));
    const place = MISCHIEF.PLACES[Math.floor(Math.random() * MISCHIEF.PLACES.length)];
    // C 从通用池 + A 性格对应组中抽取（第一个命中的性格标签决定子库）
    let group = null;
    for (const p of a.personality) {
      if (MISCHIEF.GROUP_OF[p]) { group = MISCHIEF.GROUP_OF[p]; break; }
    }
    const pool = group ? MISCHIEF.EVENTS.common.concat(MISCHIEF.EVENTS[group]) : MISCHIEF.EVENTS.common;
    const act = pool[Math.floor(Math.random() * pool.length)];

    const base = a.name + '在' + place + act;
    return Math.random() < 0.5 ? base : base + '，把' + d.name + '吓得钻进了沙发底';
  },

  /** 每月大事记：闯祸70% / 老猫温情30% / 新家来信50% 三源独立掷骰；全空按序保底1条；都无资格则本月无事 */
  rollDigest() {
    const s = this.state;
    const items = [];
    // 来源1：猫舍闯祸（≥2只在舍猫）
    if (s.cats.length >= 2 && Math.random() < MISCHIEF.CHANCE) {
      const text = this.rollMischiefText();
      if (text) items.push({ icon: '😹', text: text });
    }
    // 来源2：老猫温情（有退役在舍猫）
    const retired = s.cats.filter(c => Cat.isRetired(c, s.month));
    if (retired.length && Math.random() < DIGEST.WARM_CHANCE) {
      const c = retired[Math.floor(Math.random() * retired.length)];
      items.push({ icon: '🧡', text: DIGEST.WARM_TEXTS[Math.floor(Math.random() * DIGEST.WARM_TEXTS.length)].replace(/\{名字\}/g, c.name) });
    }
    // 来源3：新家来信（名册有在世猫）
    const alive = s.soldArchive.filter(r => !r.deceased && !r.rescued);
    if (alive.length && Math.random() < DIGEST.LETTER_CHANCE) {
      const rec = alive[Math.floor(Math.random() * alive.length)];
      items.push({ icon: '✉️', text: FOLLOWUP_TEXTS[Math.floor(Math.random() * FOLLOWUP_TEXTS.length)].replace(/\{名字\}/g, rec.name) });
    }
    // 保底：一条都没掷出时强制1条，优先闯祸
    if (!items.length) {
      const text = this.rollMischiefText();
      if (text) items.push({ icon: '😹', text: text });
      else if (retired.length) {
        const c = retired[Math.floor(Math.random() * retired.length)];
        items.push({ icon: '🧡', text: DIGEST.WARM_TEXTS[Math.floor(Math.random() * DIGEST.WARM_TEXTS.length)].replace(/\{名字\}/g, c.name) });
      } else if (alive.length) {
        const rec = alive[Math.floor(Math.random() * alive.length)];
        items.push({ icon: '✉️', text: FOLLOWUP_TEXTS[Math.floor(Math.random() * FOLLOWUP_TEXTS.length)].replace(/\{名字\}/g, rec.name) });
      }
    }
    return items;
  },

  /* ---------- 70年结算 ---------- */

  /** 结算评级 */
  ratingOf(fame, coins) {
    if (fame >= 90 && coins >= SETTLE.LEGEND_COINS) return { icon: '🏆', name: '传奇猫舍' };
    if (fame >= 70) return { icon: '🌟', name: '良心繁育人' };
    if (fame >= 40) return { icon: '🏡', name: '平凡猫舍' };
    if (fame >= 15) return { icon: '⚠️', name: '后院猫贩子' };
    return { icon: '💀', name: '行业黑名单' };
  },

  /* ---------- 直播赚钱 ---------- */

  /** 直播收益预估（不改动状态），供确认卡显示 */
  livestreamPreview() {
    const s = this.state;
    const coins = Math.round(s.energy * LIVE.COIN_PER_ENERGY);
    const fame = Math.min(
      Math.round(s.energy * LIVE.FAME_PER_ENERGY * 10) / 10,
      Math.max(0, 100 - s.fame)
    );
    return { coins: coins, fame: Math.round(fame * 10) / 10 };
  },

  /** 一键清空剩余精力换金币+名声，需至少1只猫 */
  doLivestream() {
    const s = this.state;
    if (s.gameOver || s.settled) return { ok: false, reason: '游戏已结束' };
    if (!s.cats.length) return { ok: false, reason: '猫舍里没有猫，播什么呢' };
    if (s.energy <= 0) return { ok: false, reason: '本月精力已用完' };
    const p = this.livestreamPreview();
    s.energy = 0;
    s.coins += p.coins;
    s.fame = Math.max(0, Math.min(100, Math.round((s.fame + p.fame) * 10) / 10));
    this.log('本月直播入账 ' + p.coins + ' 金币，名声+' + p.fame);
    this.save();
    return { ok: true, coins: p.coins, fame: p.fame };
  },

  /* ---------- 繁育 ---------- */

  /** 配对资格检查，返回 { ok, reason } */
  canPair(cat, role, month) {
    const age = Cat.ageMonths(cat, month);
    if (role === 'sire' && cat.sex !== 'M') return { ok: false, reason: '需要公猫' };
    if (role === 'dam' && cat.sex !== 'F') return { ok: false, reason: '需要母猫' };
    if (age < BREED.MIN_AGE) return { ok: false, reason: '不足1岁' };
    if (age >= BREED.MAX_AGE) return { ok: false, reason: '已退役' };
    if (role === 'dam' && cat.pregnancy) return { ok: false, reason: '怀孕中' };
    if (role === 'dam' && Cat.isResting(cat, month)) {
      return { ok: false, reason: '休养中，还需' + (cat.restUntil - month) + '月' };
    }
    return { ok: true, reason: '' };
  },

  /** 近亲检查，返回 d（1/2/3）或 null（安全） */
  inbreedCheck(sireId, damId) {
    const byId = id => this.state.cats.find(c => c.id === id) || null;
    const sire = byId(sireId), dam = byId(damId);
    if (!sire || !dam) return null;
    return Genetics.commonAncestorDistance(sire, dam, byId);
  },

  /** 执行配对：扣精力，母猫进入怀孕状态（含公猫基因快照，防止公猫孕期离世丢数据） */
  breed(sireId, damId) {
    const s = this.state;
    const sire = s.cats.find(c => c.id === sireId);
    const dam = s.cats.find(c => c.id === damId);
    if (!sire || !dam) return false;
    if (s.energy < BREED.ENERGY_COST) return false;
    if (!this.canPair(sire, 'sire', s.month).ok) return false;
    if (!this.canPair(dam, 'dam', s.month).ok) return false;

    const d = this.inbreedCheck(sireId, damId);
    s.energy -= BREED.ENERGY_COST;
    dam.pregnancy = {
      due: s.month + BREED.GESTATION,
      d: d,
      sireSnap: { id: sire.id, name: sire.name, genes: sire.genes, gradient: sire.gradient },
    };
    this.log(sire.name + ' 与 ' + dam.name + ' 配对成功，预产期 ' + UI.fmtDate(dam.pregnancy.due));
    this.save();
    return true;
  },

  /** 从猫名池取名：完全随机不分性别，优先不与在世猫重名，池抽空才允许重复 */
  uniqueCatName() {
    const used = new Set(this.state.cats.map(c => c.name));
    const free = CAT_NAME_POOL.filter(n => !used.has(n));
    const pool = free.length ? free : CAT_NAME_POOL;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  /** 窝数随机：1-2只30%、3只40%、4只20%、5-6只10% */
  rollLitterSize() {
    const r = Math.random();
    if (r < 0.30) return 1 + Math.floor(Math.random() * 2);
    if (r < 0.70) return 3;
    if (r < 0.90) return 4;
    return 5 + Math.floor(Math.random() * 2);
  },

  /** 产窝结算：处理所有到达预产期的母猫，返回结算结果数组 */
  settleLitters() {
    const s = this.state;
    const results = [];
    const dueDams = s.cats.filter(c => c.pregnancy && c.pregnancy.due <= s.month);

    for (const dam of dueDams) {
      const preg = dam.pregnancy;
      dam.pregnancy = null;
      // 生产后进入休养期：REST_MONTHS 个月内不可再次配对
      dam.restUntil = s.month + BREED.REST_MONTHS;
      const d = preg.d;
      const sireSnap = preg.sireSnap;
      // 公猫若仍在猫舍，用当前名字（可能已改名）
      const sireAlive = s.cats.find(c => c.id === sireSnap.id);
      const sireName = sireAlive ? sireAlive.name : sireSnap.name;

      const size = this.rollLitterSize();
      const damAge = Cat.ageMonths(dam, s.month);
      const damMod = damAge < BREED.DAM_AGE_CUTOFF ? 1.0 : BREED.DAM_AGE_MOD_OLD;
      const inbreedMod = d ? BREED.INBREED_SURVIVAL[d] : 1.0;
      const survival = BREED.BASE_SURVIVAL * inbreedMod * damMod;
      const deformRate = BREED.DEFORM_BASE + (d === 2 ? BREED.DEFORM_D2 : d === 3 ? BREED.DEFORM_D3 : 0);

      const kittens = [];
      let stillborn = 0;

      for (let i = 0; i < size; i++) {
        const sex = Math.random() < 0.5 ? 'M' : 'F';
        const genes = Genetics.generateKitten(sireSnap.genes, dam.genes, sex);

        // MM 组合 = 胚胎致死，计入夭折
        if (genes.M[0] === 'M' && genes.M[1] === 'M') { stillborn++; continue; }

        // 基因健康预判：先掷畸形（影响成活率），折耳/短腿降低成活
        const deformed = Math.random() < deformRate;
        const badGene = genes.Fd.includes('Fd') || genes.M.includes('M');
        const geneMod = (badGene ? BREED.BAD_GENE_SURVIVAL : 1) * (deformed ? BREED.DEFORM_SURVIVAL : 1);

        // 成活率判定：失败 = 出生即夭折（只播报不进面板）
        if (Math.random() >= survival * geneMod) { stillborn++; continue; }

        const markers = [];
        if (genes.M.includes('M')) markers.push('短腿');      // Mm
        if (genes.Fd.includes('Fd')) markers.push('折耳');    // Fd_

        let gradient = Math.round((sireSnap.gradient + dam.gradient) / 2 + (Math.random() * 20 - 10));
        gradient = Math.max(0, Math.min(100, gradient));

        const kitten = Cat.create(s, {
          name: this.uniqueCatName(),
          sex: sex,
          birth: s.month,
          genes: genes,
          gradient: gradient,
          personality: Cat.randomPersonality(1),
          star: Math.random() < BREED.STAR_RATE,
          health: '健康',
          sire: sireSnap.id,
          dam: dam.id,
        });

        if (deformed) {
          kitten.health = '畸形';
          s.fame = Math.max(0, s.fame + BREED.DEFORM_FAME);
          this.log(kitten.name + ' 出生即被诊断为畸形，名声 -2');
        } else if (markers.length) {
          kitten.health = markers.join('、');
        }
        if (kitten.star) this.log(kitten.name + ' 是天生顶流！');
        s.stats.born = (s.stats.born || 0) + 1;
        s.yearStats.born++;
        kittens.push(kitten);
      }

      // 近亲扣分按窝结算
      if (d) {
        s.fame = Math.max(0, Math.min(100, s.fame + BREED.INBREED_FAME[d]));
        this.log('近亲繁育惩罚：名声 ' + BREED.INBREED_FAME[d]);
      }

      // 后代数：父母各记成活仔数（用于告别卡"一生留下X只后代"；父亲可能已售出，连名册一起找）
      if (kittens.length) {
        dam.offspring = (dam.offspring || 0) + kittens.length;
        const sireRec = s.cats.concat(s.soldArchive).find(x => x.id === sireSnap.id);
        if (sireRec) sireRec.offspring = (sireRec.offspring || 0) + kittens.length;
      }

      this.log(dam.name + ' 分娩了：共产下 ' + size + ' 只，成活 ' + kittens.length + ' 只，夭折 ' + stillborn + ' 只');
      this.log(dam.name + ' 进入休养期，' + BREED.REST_MONTHS + ' 个月内不可配对');
      results.push({ damName: dam.name, sireName: sireName, d: d, size: size, kittens: kittens, stillborn: stillborn });
    }

    if (results.length) this.save();
    return results;
  },

  /* ---------- 改名 ---------- */

  renameCat(id, newName) {
    const cat = this.state.cats.find(c => c.id === id);
    if (!cat) return false;
    const name = String(newName || '').trim().slice(0, 12);
    if (!name) return false;
    const old = cat.name;
    cat.name = name;
    this.log(old + ' 改名为 ' + name);
    this.save();
    return true;
  },

  /* ---------- 统一寿命系统 ---------- */

  /** 月死亡概率：按年龄档取年死亡率折 1/12；满23岁（276月）必离世 */
  deathRisk(cat, ageMonths) {
    if (ageMonths >= LIFE.MAX) return 1;
    let yearly = 0;
    for (const [from, rate] of LIFE.RATES) {
      if (ageMonths >= from) yearly = rate;
    }
    // 折耳猫（Fd_，含杂合与纯合）满6岁后月死亡率翻倍
    if (cat && cat.genes && cat.genes.Fd && cat.genes.Fd.includes('Fd') && ageMonths >= LIFE.FOLD_RISK_AGE) {
      yearly *= 2;
    }
    return yearly / 12;
  },

  /** 死因：满15岁 50% 寿终正寝，其余从死因库均匀随机（低龄猫不寿终） */
  rollDeathCause(ageMonths) {
    if (ageMonths >= LIFE.NATURAL_MIN_AGE && Math.random() < LIFE.NATURAL_RATE) return LIFE.NATURAL;
    return DEATH_CAUSES[Math.floor(Math.random() * DEATH_CAUSES.length)];
  },

  /** 每月存活掷骰：在舍猫与名册存活猫统一寿命；返回 { cats:[{cat,cause}], recs:[{rec,cause}] } */
  rollDeaths() {
    const s = this.state;
    const out = { cats: [], recs: [] };
    // 在舍猫
    const dead = [];
    for (const c of s.cats) {
      if (Math.random() < this.deathRisk(c, Cat.ageMonths(c, s.month))) dead.push(c);
    }
    for (const c of dead) {
      const cause = this.rollDeathCause(Cat.ageMonths(c, s.month));
      if (cause === LIFE.NATURAL) {
        s.fame = Math.max(0, Math.min(100, s.fame + LIFE.NATURAL_FAME));
        s.stats.natural++;
        this.log(c.name + ' 寿终正寝，享年 ' + Cat.ageText(c, s.month) + '，名声 +' + LIFE.NATURAL_FAME);
      } else {
        this.log(c.name + ' 因' + cause + '离开了，享年 ' + Cat.ageText(c, s.month));
      }
      s.stats.deaths++;
      s.yearStats.died++;
      s.memorial.unshift({ name: c.name, ageText: Cat.ageText(c, s.month), diedAt: s.month });
      out.cats.push({ cat: c, cause: cause });
    }
    if (dead.length) s.cats = s.cats.filter(c => !dead.includes(c));
    // 名册猫（救助回舍的猫改在舍内掷骰，名册跳过）
    for (const rec of s.soldArchive) {
      if (rec.deceased || rec.rescued) continue;
      if (Math.random() >= this.deathRisk(rec, Cat.ageMonths(rec, s.month))) continue;
      rec.deceased = true;
      const cause = this.rollDeathCause(Cat.ageMonths(rec, s.month));
      rec.deathCause = cause;
      if (cause === LIFE.NATURAL) {
        s.fame = Math.max(0, Math.min(100, s.fame + LIFE.NATURAL_FAME));
        s.stats.natural++;
        this.log(rec.name + ' 在新家寿终正寝，名声 +' + LIFE.NATURAL_FAME);
      } else {
        this.log(rec.name + ' 在新家因' + cause + '离开了这个世界');
      }
      s.stats.deaths++;
      s.yearStats.died++;
      s.memorial.unshift({ name: rec.name, ageText: Cat.ageText(rec, s.month), diedAt: s.month });
      out.recs.push({ rec: rec, cause: cause });
    }
    return out;
  },

  /* ---------- 回合推进 ----------
   * 顺序：月份+1 → 回满精力扣维护/饲养 → 破产判定 → 统一寿命掷骰 → 产窝结算
   *      → 商场刷新 → 元月退休故事 → 每月大事记 → 粉丝求购 → 命运曝光 → 随访 → 年度总结 → 840结算
   * （结算在收费之后，小猫出生当月不收费，次月起正常计费）
   */
  nextMonth() {
    const s = this.state;
    if (s.gameOver || s.settled) return;

    // 1. 月份+1
    s.month += 1;

    // 2. 精力先回满，再扣维护费；扣饲养成本（成年/幼猫分档）
    s.energy = CONFIG.ENERGY_MAX;
    const maint = s.cats.length * CONFIG.MAINTENANCE_PER_CAT;
    s.energy = Math.max(0, s.energy - maint);
    const adults = s.cats.filter(c => !Cat.isJuvenile(c, s.month)).length;
    const kitties = s.cats.length - adults;
    const food = adults * FEED.ADULT + kitties * FEED.KITTEN;
    s.coins -= food;
    this.log('本月扣除维护费 ' + maint + ' 点精力');
    this.log('本月饲养成本 ' + food + ' 金币（成年猫' + adults + '只·幼猫' + kitties + '只）');

    // 3. 破产判定：金币透支 → 坏结局，跳过后续一切结算
    if (s.coins < 0) {
      s.gameOver = true;
      this.log('金币透支，猫舍经营不善，倒闭了……');
      this.save();
      UI.render();
      UI.showGameOver();
      return;
    }

    // 4. 统一寿命：在舍猫与名册猫按月掷存活骰
    const deaths = this.rollDeaths();

    // 5. 产窝结算
    const litters = this.settleLitters();

    // 6. 商场每月1日刷新货架
    this.refreshMarket();

    // 7. 每年1月：领养出去的退休猫寄回故事（存活中才寄）
    if (s.month % 12 === 0) {
      for (const rec of s.soldArchive) {
        if (rec.how === 'adopted' && !rec.deceased && Cat.ageMonths(rec, s.month) < LIFE.MAX) {
          const story = RETIRE_STORIES[Math.floor(Math.random() * RETIRE_STORIES.length)];
          this.log('【退休故事】' + story.replace('{名字}', rec.name));
        }
      }
    }

    // 8. 每月大事记：闯祸/温情/来信三源抽取（1-3条），每条写日志
    const digest = this.rollDigest();
    for (const item of digest) this.log(item.icon + ' ' + item.text);

    // 8.5 粉丝高价求购（舍内有满6月龄顶流猫时 5%）
    const fanOffer = this.rollFanOffer();

    // 9. 售出猫命运曝光（黑暗/百万）
    const reveals = this.checkFateReveals();

    // 10. 年度随访（流浪求救/主人失联/日常）
    const followups = this.checkFollowups();

    // 10.5 年度总结卡：每年12月结束时
    let yearCard = null;
    if (s.month % 12 === 0) {
      yearCard = { year: s.month / 12, born: s.yearStats.born, sold: s.yearStats.sold, died: s.yearStats.died, alive: s.cats.length };
      s.yearStats = { born: 0, sold: 0, died: 0 };
    }

    // 11. 70年结算：第840个月结束
    let settleNow = false;
    if (s.month >= SETTLE.MONTHS) {
      s.settled = true;
      settleNow = true;
      const r = this.ratingOf(s.fame, s.coins);
      this.log('70年经营期满，最终评级：' + r.icon + ' ' + r.name);
    }

    this.save();
    UI.render();
    for (const d of deaths.cats) UI.enqueueModal(() => UI.showFarewell(d.cat, d.cause, true));
    for (const d of deaths.recs) UI.enqueueModal(() => UI.showFarewell(d.rec, d.cause, false));
    for (const res of litters) {
      UI.enqueueModal(() => UI.showLitter(res));
    }
    for (const ev of followups) {
      if (ev.type === 'stray') UI.enqueueModal(() => UI.showRescueChoice(ev.rec));
    }
    if (digest.length) UI.enqueueModal(() => UI.showDigest(s.month, digest));
    if (fanOffer) UI.enqueueModal(() => UI.showFanOffer(fanOffer));
    if (yearCard) UI.enqueueModal(() => UI.showYearSummary(yearCard));
    if (settleNow) UI.enqueueModal(() => UI.showFinalSettlement());
  },
};
