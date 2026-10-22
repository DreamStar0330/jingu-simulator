/* ==========================================================
 * 金故模拟器 · 猫的构造与工具
 * ========================================================== */

const Cat = {

  /**
   * 创建一只猫并加入 state.cats
   * @param {object} state 游戏状态（用于分配 id）
   * @param {object} opts  { name, sex, birth, genes, gradient, personality, star, health, sire, dam }
   */
  create(state, opts) {
    const cat = {
      id: 'cat_' + String(state.nextCatId).padStart(4, '0'),
      name: opts.name,
      sex: opts.sex,                      // 'M' 公 | 'F' 母
      birth: opts.birth,                  // 绝对月份索引：第1年1月 = 0
      genes: opts.genes,                  // 9个基因座，O座公猫1个等位基因、母猫2个
      gradient: opts.gradient || 0,       // 渐层度 0-100
      personality: opts.personality || [],
      star: !!opts.star,                  // true = 顶流体质
      health: opts.health || '健康',      // 健康 / 短腿 / 折耳 / 短腿、折耳 / 畸形
      sire: opts.sire || null,            // 父id
      dam: opts.dam || null,              // 母id
      pedigree: opts.pedigree || null,    // 血统证书风味文字（纯展示，不参与遗传）
      pregnancy: null,                    // 怀孕信息 { due, d, sireSnap }，未怀孕为 null
      restUntil: null,                    // 休养截止月（生产后4个月内不可配对）
      offspring: 0,                       // 一生留下的后代数（成活幼猫）
    };
    state.nextCatId += 1;
    state.cats.push(cat);
    return cat;
  },

  /* ---------- 随机工具 ---------- */

  randomName() {
    return CAT_NAME_POOL[Math.floor(Math.random() * CAT_NAME_POOL.length)];
  },

  randomPersonality(count) {
    const n = count || 2;
    const pool = [...PERSONALITY_POOL];
    const out = [];
    for (let i = 0; i < n && pool.length; i++) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
  },

  /* ---------- 显示工具 ---------- */

  ageMonths(cat, month) {
    return month - cat.birth;
  },

  /** "X岁X月" */
  ageText(cat, month) {
    const m = Cat.ageMonths(cat, month);
    return Math.floor(m / 12) + '岁' + (m % 12) + '月';
  },

  /** 出生年月；开局前的猫显示"开局前X个月" */
  birthText(birth) {
    if (birth < 0) return '开局前' + (-birth) + '个月';
    return '第' + (Math.floor(birth / 12) + 1) + '年' + (birth % 12 + 1) + '月';
  },

  sexText(sex) {
    return sex === 'M' ? '公' : '母';
  },

  /** 幼年：月龄 < 12 */
  isJuvenile(cat, month) {
    return Cat.ageMonths(cat, month) < 12;
  },

  /** 母猫是否在休养期中 */
  isResting(cat, month) {
    return !!(cat.restUntil && cat.restUntil > month);
  },

  /** 是否已退役：满84月（7岁） */
  isRetired(cat, month) {
    return Cat.ageMonths(cat, month) >= RETIRE.AGE;
  },

  /* ---------- 头像图片 ---------- */

  /** 花色 → 图库花色代码（加白最优先；重点色按基础花色取图） */
  avatarColorOf(cat, coat) {
    const g = cat.genes;
    // 1. 加白最优先：三花、红白、玳瑁加白、渐层加白统一用 bicolor
    if (g.S && g.S.includes('S')) return 'bicolor';
    // 2. 玳瑁系
    if (coat.baseKey === 'tortie') return 'tortie';
    if (coat.baseKey === 'blueCream') return 'bluecream';
    // 3. 红/乳（含红渐层，dd 走奶油色）
    if (coat.series === 'red') {
      return (g.D && !g.D.includes('D')) ? 'cream' : 'red';
    }
    // 4. 渐层系（按代码前缀）
    if (coat.code) {
      if (coat.code === 'ny11' || coat.code === 'ny12' || coat.code === 'ny25') return coat.code;
      const prefix = coat.code.slice(0, 2);
      if (prefix === 'ay') return 'ay';
      if (prefix === 'by') return 'by';
      if (prefix === 'cy') return 'cy';
      if (prefix === 'as') return 'as';
      if (coat.code[1] === 's') return 'ns';   // 其余银渐层（ns/bs/os/ps）就近
      return 'ny11';                           // oy/py 金渐层无图，就近取 ny11
    }
    // 5. 纯色（小鹿兜底用 lilac）
    return {
      black: 'black', blue: 'blue', chocolate: 'chocolate', lilac: 'lilac',
      cinnamon: 'cinnamon', fawn: 'lilac',
    }[coat.baseKey] || 'blue';
  },

  /** 性格 → 神态代码（取第一个可映射的标签） */
  avatarMoodOf(cat) {
    for (const p of cat.personality) {
      const m = MOOD_OF_PERSONALITY[p];
      if (m) return m;
    }
    return CAT_IMAGES.MOODS[Math.floor(Math.random() * CAT_IMAGES.MOODS.length)];
  },

  /** 拼图片文件名：cat_花色_神态_序号.jpeg；该花色无此神态时从任意神态随机 */
  avatarFile(color, mood) {
    const m = CAT_IMAGES.MOODS.includes(mood)
      ? mood
      : CAT_IMAGES.MOODS[Math.floor(Math.random() * CAT_IMAGES.MOODS.length)];
    const v = String(1 + Math.floor(Math.random() * CAT_IMAGES.VARIANTS)).padStart(2, '0');
    return 'cat_' + color + '_' + m + '_' + v + CAT_IMAGES.EXT;
  },

  /** 为猫选定终身头像（花色+神态随机变体） */
  rollAvatar(cat) {
    const color = Cat.avatarColorOf(cat, Genetics.coat(cat));
    const mood = Cat.avatarMoodOf(cat);
    if (CAT_IMAGES.COLORS.includes(color)) return Cat.avatarFile(color, mood);
    // 该花色一张都没有 → kitten 兜底；kitten 也缺货 → blue
    if (CAT_IMAGES.KITTENS.length) {
      return CAT_IMAGES.KITTENS[Math.floor(Math.random() * CAT_IMAGES.KITTENS.length)];
    }
    return Cat.avatarFile('blue', mood);
  },

  /** 显示用头像路径：幼年统一 kitten（按 id 稳定选变体），成年用选定图 */
  avatarSrc(cat, month) {
    if (!cat.avatar) cat.avatar = Cat.rollAvatar(cat);    // 首次显示时选定，终身不变
    if (Cat.isJuvenile(cat, month) && CAT_IMAGES.KITTENS.length) {
      let h = 0;
      for (const ch of cat.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return CAT_IMAGES.PATH + CAT_IMAGES.KITTENS[h % CAT_IMAGES.KITTENS.length];
    }
    return CAT_IMAGES.PATH + cat.avatar;
  },
};
