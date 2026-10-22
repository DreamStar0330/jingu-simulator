/* ==========================================================
 * 金故模拟器 · 花色判定与繁育遗传
 *
 * 花色判定顺序（严格按设计文档）：
 * 1. L：L_=短毛，ll=长毛
 * 2. O（X连锁）：公猫带O=红系；母猫OO=红、Oo=玳瑁、oo走普通流程
 * 3. aa=纯色（B/D组合决定黑/蓝/巧克力/丁香/肉桂/小鹿）
 * 4. A_=渐层系（I_=银渐层、ii=金渐层，基色深浅由B/D决定）
 * 5. 渐层度：≥80=12色、40-79=11色、<40=25色
 * 6. S_=名字加"加白"后缀
 * ========================================================== */

const Genetics = {

  /**
   * 判定花色
   * @returns {{
   *   name: string, longhair: boolean, baseKey: string,
   *   series: 'solid'|'red'|'silver'|'golden',   // 用于定价的花色大类
   *   code: string|null,                          // 渐层系代码（如 ny11 / ay25），红系/玳瑁/纯色为 null
   *   displayCode: string|null,                   // 重点色的显示代码（如 ny33），非重点色为 null
   *   isGradient: boolean,                        // 是否银/金渐层（参与渐层度定价加成）
   *   pointed: boolean                            // 是否重点色（cs/cs）
   * }}
   */
  coat(cat) {
    const g = cat.genes;
    const has = (locus, al) => g[locus].includes(al);

    const longhair = !has('L', 'L');   // 没有 L 即 ll = 长毛
    const dilute = !has('D', 'D');     // dd = 稀释色
    const agouti = has('A', 'A');      // A_ = 渐层系
    const inhibitor = has('I', 'I');   // I_ = 银系
    const white = has('S', 'S');       // S_ = 加白
    const pointed = !!(g.C && !g.C.includes('C'));   // cs/cs = 重点色（隐性）
    const male = cat.sex === 'M';

    // O 座（X连锁）：公猫只存1个等位基因，母猫2个
    const redCount = g.O.filter(a => a === 'O').length;
    const isTortie = !male && redCount === 1;                 // 母猫 Oo
    const isRed = male ? redCount >= 1 : redCount === 2;      // 公 O_ / 母 OO

    // 基色：[代码, 中文前缀] —— n黑 a蓝 b巧克力 c丁香 o肉桂 p小鹿
    const baseOf = () => {
      if (has('B', 'B')) return dilute ? ['a', '蓝'] : ['n', ''];
      if (g.B.includes('b')) return dilute ? ['c', '丁香'] : ['b', '巧克力']; // bb 或 b/b1
      return dilute ? ['p', '小鹿'] : ['o', '肉桂'];                          // b1b1
    };

    const levelCode = () => cat.gradient >= 80 ? '12' : cat.gradient >= 40 ? '11' : '25';

    let name, baseKey, series, code = null, displayCode = null, isGradient = false;

    if (isTortie) {
      // Oo 母猫：ss=玳瑁/蓝乳玳瑁，S_=三花/蓝乳三花（一律不进入渐层判定）
      name = (inhibitor ? '银' : '') +
        (white ? (dilute ? '蓝乳三花' : '三花') : (dilute ? '蓝乳玳瑁' : '玳瑁'));
      baseKey = dilute ? 'blueCream' : 'tortie';
      series = 'red';                          // 玳瑁按红系定价
    } else if (isRed) {
      // 红系：B座被红遮蔽，按 D 分红/乳
      series = 'red';
      if (agouti) {
        name = (inhibitor ? '银' : '') + (dilute ? '乳' : '红') + '渐层 '
             + (dilute ? 'd' : 'e') + (inhibitor ? 's' : 'y') + levelCode();
        baseKey = inhibitor ? (dilute ? 'cream' : 'redSilver') : 'redGolden';
      } else {
        name = white ? (dilute ? '乳白' : '橘白') : (dilute ? '乳纯色' : '红纯色');
        baseKey = dilute ? 'cream' : 'red';
      }
    } else if (!agouti) {
      // aa 纯色（cs/cs 时统一叫重点色，图片仍按基础色取）
      const [code0, label] = baseOf();
      name = pointed ? '重点色' : label + '纯色';
      baseKey = { n: 'black', a: 'blue', b: 'chocolate', c: 'lilac', o: 'cinnamon', p: 'fawn' }[code0];
      series = 'solid';
    } else {
      // A_ 渐层系
      const [code0, label] = baseOf();
      code = code0 + (inhibitor ? 's' : 'y') + levelCode();
      if (pointed) {
        displayCode = code0 + (inhibitor ? 's' : 'y') + '33';
        const pointLabel = { n: '', a: '蓝', b: '巧克力', c: '紫', o: '肉桂', p: '小鹿' }[code0];
        name = pointLabel + (inhibitor ? '银' : '金') + '点 ' + displayCode;
      } else {
        name = label + (inhibitor ? '银渐层 ' : '金渐层 ') + code;
      }
      baseKey = inhibitor ? 'silver' : 'golden';
      series = inhibitor ? 'silver' : 'golden';
      isGradient = true;
    }

    // 三花、橘白/乳白已含"白"义，不再追加"加白"
    if (white && !(isTortie || (isRed && !agouti))) name += ' 加白';
    return { name, longhair, baseKey, series, code, displayCode, isGradient, pointed };
  },

  /**
   * 近亲检查：沿双方 sire/dam 向上追溯最多3代，找最近共同祖先
   * 距离定义：自己=0、父母=1、祖辈=2、曾祖辈=3
   * d = 双方到共同祖先步数中较大的那个；无共同祖先返回 null（安全）
   * @returns {number|null} 1 / 2 / 3 / null
   */
  commonAncestorDistance(catA, catB, byId) {
    const distOf = start => {
      const dist = { [start.id]: 0 };
      let frontier = [start];
      for (let depth = 1; depth <= 3; depth++) {
        const next = [];
        for (const c of frontier) {
          for (const pid of [c.sire, c.dam]) {
            if (!pid) continue;
            const p = byId(pid);
            if (!p || p.id in dist) continue;
            dist[p.id] = depth;
            next.push(p);
          }
        }
        frontier = next;
        if (!frontier.length) break;
      }
      return dist;
    };
    const dA = distOf(catA), dB = distOf(catB);
    let best = null;
    for (const id in dA) {
      if (id in dB) {
        const d = Math.max(dA[id], dB[id]);
        if (best === null || d < best) best = d;
      }
    }
    return best;
  },

  /**
   * 基因遗传：每个基因座父母各随机传一个等位基因（各50%）
   * O座X连锁特殊处理：女儿 = 父亲的O + 母亲两个中随机一个；
   *                   儿子 = 母亲两个中随机一个（只存1个）
   */
  generateKitten(sireGenes, damGenes, sex) {
    const genes = {};
    for (const locus of LOCI_ORDER) {
      if (locus === 'O') {
        if (sex === 'F') {
          genes.O = [sireGenes.O[0], damGenes.O[Math.floor(Math.random() * damGenes.O.length)]];
        } else {
          genes.O = [damGenes.O[Math.floor(Math.random() * damGenes.O.length)]];
        }
      } else {
        genes[locus] = [
          sireGenes[locus][Math.floor(Math.random() * 2)],
          damGenes[locus][Math.floor(Math.random() * 2)],
        ];
      }
    }
    return genes;
  },

  /* ---------- 商场猫基因生成 ---------- */

  /**
   * 按品控层级随机生成一只商场猫的九座基因
   * @param {'solid'|'gradient'|'rare'} tier 品控层级
   * @param {'M'|'F'} sex
   *
   * solid    ：aa 纯色底（O座随机，可出红纯/玳瑁；S/L/Fd 随机）
   * gradient ：A_ 渐层系、O座锁 oo（不出红系）、I 座随机（银/金）
   * rare     ：ii 锁金系，50% 蓝金 ay（B_ + dd）/ 50% 丁香金 cy（bb + dd），O座锁 oo
   * M 座只会生成 m/m 或 M/m（不会出现 MM 胚胎致死组合）
   */
  randomMarketGenes(tier, sex) {
    const w = list => {           // 加权抽取单个等位基因：[[allele, weight], ...]
      let r = Math.random();
      for (const [a, p] of list) { r -= p; if (r < 0) return a; }
      return list[list.length - 1][0];
    };
    const pair = list => [w(list), w(list)];
    const g = {};

    // A 座
    if (tier === 'solid') g.A = ['a', 'a'];
    else g.A = pair([['A', 0.5], ['a', 0.5]]);

    // B / D / I 座
    if (tier === 'rare') {
      g.I = ['i', 'i'];
      g.B = Math.random() < 0.5 ? ['B', w([['B', 0.5], ['b', 0.5]])] : ['b', 'b']; // ay 需 B_，cy 需 bb
      g.D = ['d', 'd'];
    } else {
      g.I = pair([['I', 0.5], ['i', 0.5]]);
      g.B = pair([['B', 0.6], ['b', 0.3], ['b1', 0.1]]);
      g.D = pair([['D', 0.75], ['d', 0.25]]);
    }

    // O 座（X连锁）：渐层/稀有色锁 oo；纯色随机（可出红纯/玳瑁）
    if (tier === 'solid') {
      const oPair = pair([['O', 0.2], ['o', 0.8]]);
      g.O = sex === 'M' ? [oPair[0]] : oPair;
    } else {
      g.O = sex === 'M' ? ['o'] : ['o', 'o'];
    }

    g.S  = pair([['S', 0.3], ['s', 0.7]]);
    g.L  = pair([['L', 0.5], ['l', 0.5]]);
    g.Fd = pair([['Fd', 0.2], ['fd', 0.8]]);
    // C 座：三成为点色携带者（C/cs），不直接生成 cs/cs
    g.C  = Math.random() < 0.3 ? ['C', 'cs'] : ['C', 'C'];

    // M 座：只允许 m/m 或 M/m
    const m1 = w([['M', 0.15], ['m', 0.85]]);
    const m2 = w([['M', 0.15], ['m', 0.85]]);
    g.M = (m1 === 'M' && m2 === 'M') ? ['M', 'm'] : [m1, m2];

    return g;
  },
};
