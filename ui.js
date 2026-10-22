/* ==========================================================
 * 金故模拟器 · 界面渲染与交互
 * ========================================================== */

const UI = {

  _modalQueue: [],
  _modalLocked: false,   // 感谢页等终局画面锁定弹窗，屏蔽 Esc/遮罩关闭

  init() {
    if (!Game.load()) Game.newGame();

    // 欢迎页：点击进入猫舍（每次打开都显示，纯前置页）
    document.getElementById('btn-welcome-enter').addEventListener('click', () => {
      document.getElementById('welcome-page').hidden = true;
    });

    document.getElementById('btn-next').addEventListener('click', () => Game.nextMonth());
    document.getElementById('btn-restart').addEventListener('click', () => UI.showRestartConfirm());
    document.getElementById('btn-breed').addEventListener('click', () => UI.showBreedModal());
    document.getElementById('btn-market').addEventListener('click', () => UI.showMarket());
    document.getElementById('btn-live').addEventListener('click', () => UI.showLiveConfirm());
    document.getElementById('btn-about').addEventListener('click', () => UI.showAbout());

    // Esc 关闭弹窗
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') UI.closeModal();
    });

    UI.render();

    // 开局卡：新存档首次打开时显示，仅一次
    if (!Game.state.openingShown) {
      Game.state.openingShown = true;
      Game.save();
      UI.showOpening();
    }

    // 存档已破产/已结算：直接展示对应结局卡
    if (Game.state.gameOver) UI.showGameOver();
    else if (Game.state.settled) UI.showFinalSettlement();
  },

  fmtDate(month) {
    return '第' + (Math.floor(month / 12) + 1) + '年' + (month % 12 + 1) + '月';
  },

  /* ---------- 整体渲染 ---------- */

  render() {
    const s = Game.state;

    document.getElementById('stat-date').textContent = UI.fmtDate(s.month);
    document.getElementById('stat-coins').textContent = '💰 ' + s.coins;
    document.getElementById('stat-energy').textContent = '⚡ ' + s.energy + '/' + CONFIG.ENERGY_MAX;
    document.getElementById('stat-fame').textContent = '⭐ 名声 ' + s.fame + '/100';
    document.getElementById('stat-born').textContent = '🐣 出生 ' + (s.stats.born || 0);
    document.getElementById('stat-deaths').textContent = '🌈 死亡 ' + (s.stats.deaths || 0);

    // 破产/结算：冻结推进/商场/繁育按钮（重新开始保持可用）
    const over = !!s.gameOver || !!s.settled;
    document.getElementById('btn-next').disabled = over;
    document.getElementById('btn-market').disabled = over;
    document.getElementById('btn-breed').disabled = over;
    // 直播：游戏结束 / 精力为0 / 猫舍没猫 时置灰
    document.getElementById('btn-live').disabled = over || s.energy <= 0 || !s.cats.length;

    UI.renderCats(s);
    UI.renderMemorial(s);
    UI.renderLog(s);
  },

  renderCats(s) {
    const gridR = document.getElementById('cat-grid-r');
    const gridM = document.getElementById('cat-grid-m');
    const gridF = document.getElementById('cat-grid-f');
    gridR.innerHTML = '';
    gridM.innerHTML = '';
    gridF.innerHTML = '';

    // 三栏：退役(≥84月) / 公 / 母；各栏按年龄从大到小（birth 越小越年长）
    const retired = s.cats.filter(c => Cat.isRetired(c, s.month)).sort((a, b) => a.birth - b.birth);
    const males = s.cats.filter(c => !Cat.isRetired(c, s.month) && c.sex === 'M').sort((a, b) => a.birth - b.birth);
    const females = s.cats.filter(c => !Cat.isRetired(c, s.month) && c.sex === 'F').sort((a, b) => a.birth - b.birth);
    document.getElementById('cat-title-r').textContent = '🎓 退役编制（' + retired.length + '只）';
    document.getElementById('cat-title-m').textContent = '公猫（' + males.length + '只）';
    document.getElementById('cat-title-f').textContent = '母猫（' + females.length + '只）';
    document.getElementById('cat-counts').textContent =
      '在职猫咪 ' + s.cats.length + ' 只（公' + males.length + ' · 母' + females.length + ' · 退役' + retired.length + '）';

    document.getElementById('cat-empty').hidden = s.cats.length > 0;
    if (!s.cats.length) return;

    const buildCard = (cat, grid) => {
      const coat = Genetics.coat(cat);
      // 母猫状态：怀孕中 / 休养中 / 正常（无标记）
      let statusLine = '';
      if (cat.pregnancy) {
        statusLine = '<div class="cat-preg">🤰 预产期 ' + UI.fmtDate(cat.pregnancy.due) + '</div>';
      } else if (Cat.isResting(cat, s.month)) {
        statusLine = '<div class="cat-rest">💤 休养中，还需' + (cat.restUntil - s.month) + '月</div>';
      }
      // 左上角徽章：幼年 / 退役（互斥）
      let badge = '';
      if (Cat.isJuvenile(cat, s.month)) badge = '<div class="cat-juv">幼年</div>';
      else if (Cat.isRetired(cat, s.month)) badge = '<div class="cat-retired">🎓 退役</div>';

      const card = document.createElement('div');
      card.className = 'cat-card' + (cat.star ? ' star' : '') + (Cat.isRetired(cat, s.month) ? ' retired' : '');
      card.innerHTML =
        badge +
        '<img class="avatar avatar-img" src="' + Cat.avatarSrc(cat, s.month) + '" alt="">' +
        '<div class="cat-name">' + cat.name + ' ' + (cat.sex === 'M' ? '♂' : '♀') + '</div>' +
        '<div class="cat-age">' + Cat.ageText(cat, s.month) + '</div>' +
        '<div class="cat-coat">' + coat.name + '</div>' +
        (cat.star ? '<div class="cat-star">✨ 顶流</div>' : '') +
        statusLine;
      card.addEventListener('click', () => UI.showCatModal(cat));
      grid.appendChild(card);
    };
    for (const cat of retired) buildCard(cat, gridR);
    for (const cat of males) buildCard(cat, gridM);
    for (const cat of females) buildCard(cat, gridF);
  },

  /* ---------- 纪念册（第四栏：所有离世猫，最新在上，超12条自动缓慢上滚） ---------- */

  renderMemorial(s) {
    const list = document.getElementById('memorial-list');
    document.getElementById('cat-title-mem').textContent = '🕯 纪念册（' + s.memorial.length + '）';
    if (!s.memorial.length) {
      list.innerHTML = '<div class="memorial-empty">还没有猫离开，愿这一天晚点来</div>';
      return;
    }
    const item = m =>
      '<div class="memorial-item"><span class="memorial-name">' + m.name + '</span>' +
      '<span class="memorial-age">活了' + m.ageText + '</span></div>';
    const rows = s.memorial.map(item).join('');
    // 超过12条：内容双份渲染 + translateY(-50%) 无缝循环，时长随条数
    if (s.memorial.length > 12) {
      list.innerHTML = '<div class="memorial-track auto" style="animation-duration:' +
        (s.memorial.length * 1.2) + 's">' + rows + rows + '</div>';
    } else {
      list.innerHTML = '<div class="memorial-track">' + rows + '</div>';
    }
  },

  renderLog(s) {
    const list = document.getElementById('log-list');
    list.innerHTML = '';
    for (const item of s.log) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="log-date">' + UI.fmtDate(item.month) + '</span>' + item.text;
      list.appendChild(li);
    }
  },

  /* ---------- 弹窗基础设施（带队列：讣告/产窝逐个弹出） ---------- */

  openModal(inner) {
    UI._modalLocked = false;
    const root = document.getElementById('modal-root');
    root.hidden = false;
    root.innerHTML = '<div class="modal-overlay">' + inner + '</div>';
    root.querySelector('.modal-overlay').addEventListener('click', e => {
      if (UI._modalLocked) return;
      if (e.target.classList.contains('modal-overlay') || e.target.closest('[data-close]')) {
        UI.closeModal();
      }
    });
  },

  closeModal() {
    if (UI._modalLocked) return;
    const root = document.getElementById('modal-root');
    root.hidden = true;
    root.innerHTML = '';
    UI._pumpModal();
  },

  enqueueModal(fn) {
    UI._modalQueue.push(fn);
    UI._pumpModal();
  },

  _pumpModal() {
    const root = document.getElementById('modal-root');
    if (!root.hidden) return;          // 有弹窗在显示，等它关闭
    const fn = UI._modalQueue.shift();
    if (fn) fn();
  },

  /* ---------- 通用确认弹窗 ---------- */

  showConfirm(title, html, okText, onOk) {
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">' + title + '</div>' +
        '<div class="confirm-text">' + html + '</div>' +
        '<div class="confirm-btns">' +
          '<button class="btn btn-ghost" data-close>取消</button>' +
          '<button class="btn btn-primary btn-sm" id="btn-confirm-ok">' + okText + '</button>' +
        '</div>' +
      '</div>');
    document.getElementById('btn-confirm-ok').addEventListener('click', () => { onOk(); });
  },

  /* ---------- 直播赚钱 ---------- */

  /** 开播确认卡：显示精力与预估金币+名声，确认才执行 */
  showLiveConfirm() {
    const s = Game.state;
    const p = Game.livestreamPreview();
    UI.showConfirm('📺 直播赚钱',
      '本月剩余精力 ' + s.energy + ' 点，直播可赚 ' + p.coins + ' 金币、名声+' + p.fame + '，确定开播？',
      '开播',
      () => {
        const r = Game.doLivestream();
        UI.closeModal();
        UI.render();
        if (r.ok) UI.enqueueModal(() => UI.showLiveToast(r.coins, r.fame));
      });
  },

  showLiveToast(coins, fame) {
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">直播结束！</div>' +
        '<div class="confirm-text">本月直播入账 ' + coins + ' 金币，名声+' + fame + '</div>' +
        '<div class="confirm-btns">' +
          '<button class="btn btn-primary btn-sm" data-close>知道了</button>' +
        '</div>' +
      '</div>');
  },

  /* ---------- 关于 ---------- */

  showAbout() {
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">🐱 金故模拟器</div>' +
        '<div class="confirm-text about-text">' +
          '<p>英国长毛猫猫舍经营模拟：繁育花色小猫、经营猫舍，书写70年繁育人生。</p>' +
          '<p>本作由 <b>Maisie</b> 从零设计并主导开发（开山老祖）。</p>' +
          '<p class="about-license">授权声明：本游戏为爱发电，永久免费。欢迎下载、分享、修改数据二次创作，但任何修改版与传播版必须在显著位置保留原作者署名“Maisie”。</p>' +
          '<p>联系邮箱：15976990190@163.com</p>' +
        '</div>' +
        '<div class="confirm-btns">' +
          '<button class="btn btn-primary btn-sm" data-close>知道了</button>' +
        '</div>' +
      '</div>');
  },

  /* ---------- 猫详情弹窗 ---------- */

  showCatModal(cat) {
    const s = Game.state;
    const coat = Genetics.coat(cat);
    const g = cat.genes;
    const age = Cat.ageMonths(cat, s.month);
    const retired = Cat.isRetired(cat, s.month);

    // 三代族谱：只存父母id，祖辈/曾祖辈向上递归推导
    const byId = id => s.cats.find(c => c.id === id) || null;
    const nameOf = id => {
      if (!id) return '未知';
      const c = byId(id);
      return c ? c.name + '（' + c.id + '）' : id + '（已离开猫舍）';
    };
    const sire = byId(cat.sire), dam = byId(cat.dam);
    const gen1 = [nameOf(cat.sire), nameOf(cat.dam)];
    const gen2 = [], gen3 = [];
    for (const p of [sire, dam]) {
      if (p) {
        gen2.push(nameOf(p.sire), nameOf(p.dam));
        for (const gp of [byId(p.sire), byId(p.dam)]) {
          if (gp) gen3.push(nameOf(gp.sire), nameOf(gp.dam));
          else gen3.push('未知', '未知');
        }
      } else {
        gen2.push('未知', '未知');
        gen3.push('未知', '未知', '未知', '未知');
      }
    }
    const fmtGen = arr => arr.every(x => x === '未知') ? '未知' : arr.join(' · ');

    // 母猫状态行
    let statusRow = '';
    if (cat.pregnancy) {
      statusRow = '<div class="kv"><span>状态</span>🤰 怀孕中，预产期 ' + UI.fmtDate(cat.pregnancy.due) + '</div>';
    } else if (Cat.isResting(cat, s.month)) {
      statusRow = '<div class="kv"><span>状态</span>💤 休养中，还需 ' + (cat.restUntil - s.month) + ' 月可再次配对</div>';
    }

    // 操作区：退役三选一 / 挂牌出售
    let actionSection = '';
    if (retired) {
      actionSection =
        '<div class="modal-section"><h4>养老安排</h4>' +
          '<div class="retire-btns">' +
            '<button class="btn btn-ghost btn-sm" id="btn-keep">🏠 自留养老</button>' +
            '<button class="btn btn-primary btn-sm" id="btn-transfer">💰 低价转让（' + RETIRE.TRANSFER_PRICE + ' 金币）</button>' +
            '<button class="btn btn-ghost btn-sm" id="btn-adopt">🕊 免费领养（名声 +' + RETIRE.ADOPT_FAME + '）</button>' +
          '</div>' +
        '</div>';
    } else if (!cat.pregnancy && age >= PRICE.MIN_SELL_AGE) {
      actionSection =
        '<div class="modal-section"><h4>出售</h4>' +
          '<div class="sell-line">挂牌出售 · 估价 <b>' + Game.priceOf(cat) + '</b> 金币' +
            '<button class="btn btn-primary btn-sm" id="btn-sell">出售</button>' +
            '<button class="btn btn-ghost btn-sm" id="btn-adopt-free">免费领养</button>' +
          '</div>' +
        '</div>';
    }

    UI.openModal(
      '<div class="modal-card modal-cat">' +
        '<button class="modal-close" data-close>✕</button>' +
        '<div class="modal-head">' +
          '<img class="avatar avatar-lg avatar-img" src="' + Cat.avatarSrc(cat, s.month) + '" alt="">' +
          '<div>' +
            '<div class="modal-title">' + cat.name +
              '<button class="rename-btn" id="btn-rename-cat" title="改名">✏️</button>' +
              '<span class="sex-tag">' + Cat.sexText(cat.sex) + '</span></div>' +
            '<div class="modal-sub">' + coat.name + ' · ' + (coat.longhair ? '长毛' : '短毛') + (cat.star ? ' · ✨顶流体质' : '') + (retired ? ' · 🎓已退役' : '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-section"><h4>基础信息</h4>' +
          '<div class="kv"><span>性别</span>' + Cat.sexText(cat.sex) + '</div>' +
          '<div class="kv"><span>出生</span>' + Cat.birthText(cat.birth) + '</div>' +
          '<div class="kv"><span>年龄</span>' + Cat.ageText(cat, s.month) + '</div>' +
          '<div class="kv"><span>花色</span>' + coat.name + '</div>' +
          '<div class="kv"><span>健康</span>' + cat.health + '</div>' +
          '<div class="kv"><span>月成本</span>' + (Cat.isJuvenile(cat, s.month) ? FEED.KITTEN : FEED.ADULT) + ' 金币/月</div>' +
          '<div class="kv"><span>体质</span>' + (cat.star ? '✨ 顶流' : '普通') + '</div>' +
          (cat.pedigree ? '<div class="kv"><span>血统证书</span>' + cat.pedigree + '</div>' : '') +
          statusRow +
        '</div>' +
        '<div class="modal-section"><h4>基因卡</h4>' +
          '<div class="gene-grid">' +
            LOCI_ORDER.map(locus =>
              '<div class="gene-item">' +
                '<div class="gene-locus">' + locus + '</div>' +
                '<div class="gene-alleles">' + g[locus].join(' / ') + '</div>' +
                '<div class="gene-desc">' + LOCI_INFO[locus] + '</div>' +
              '</div>').join('') +
          '</div>' +
          '<div class="kv kv-gradient"><span>渐层度</span>' + cat.gradient + ' / 100</div>' +
        '</div>' +
        '<div class="modal-section"><h4>性格</h4>' +
          '<div class="tags">' + cat.personality.map(p => '<span class="tag">' + p + '</span>').join('') + '</div>' +
        '</div>' +
        '<div class="modal-section"><h4>三代族谱</h4>' +
          '<div class="ped-row"><span class="ped-label">亲代</span>' + gen1.join(' · ') + '</div>' +
          '<div class="ped-row"><span class="ped-label">祖辈</span>' + fmtGen(gen2) + '</div>' +
          '<div class="ped-row"><span class="ped-label">曾祖辈</span>' + fmtGen(gen3) + '</div>' +
        '</div>' +
        actionSection +
      '</div>'
    );

    document.getElementById('btn-rename-cat').addEventListener('click', () => UI.showRenameModal(cat));

    const keepBtn = document.getElementById('btn-keep');
    if (keepBtn) keepBtn.addEventListener('click', () => UI.closeModal());
    const transferBtn = document.getElementById('btn-transfer');
    if (transferBtn) {
      transferBtn.addEventListener('click', () => {
        UI.showConfirm('低价转让',
          cat.name + ' 将以 ' + RETIRE.TRANSFER_PRICE + ' 金币转让给靠谱新家，从此离开猫舍。',
          '确认转让',
          () => {
            Game.transferRetiredCat(cat.id);
            UI.closeModal();
            UI.render();
            UI.enqueueModal(() => UI.showSoldToast(cat.name));
          });
      });
    }
    const adoptBtn = document.getElementById('btn-adopt');
    if (adoptBtn) {
      adoptBtn.addEventListener('click', () => {
        UI.showConfirm('免费领养',
          cat.name + ' 将被免费领养，名声 +' + RETIRE.ADOPT_FAME + '，每年1月可能收到它的新家近况。',
          '确认领养',
          () => { Game.adoptRetiredCat(cat.id); UI.closeModal(); UI.render(); });
      });
    }
    const sellBtn = document.getElementById('btn-sell');
    if (sellBtn) sellBtn.addEventListener('click', () => UI.showSellConfirm(cat));
    const adoptFreeBtn = document.getElementById('btn-adopt-free');
    if (adoptFreeBtn) adoptFreeBtn.addEventListener('click', () => UI.showAdoptFreeConfirm(cat));
  },

  /* ---------- 出售确认 ---------- */

  showSellConfirm(cat) {
    const s = Game.state;
    const price = Game.priceOf(cat);
    const warn = cat.health !== '健康'
      ? '<div class="report-box report-warn">注意：' + cat.name + ' 为「' + cat.health + '」，成交后名声 ' + PRICE.BAD_HEALTH_FAME + '。</div>'
      : '';
    UI.showConfirm('确认出售',
      '以 <b>' + price + '</b> 金币出售 ' + cat.name + '？' +
      '成交后将进入已售出名册，金币立即到账。' + warn,
      '确认成交',
      () => {
        const r = Game.sellCat(cat.id);
        if (r.ok) {
          UI.closeModal();
          UI.render();
          UI.enqueueModal(() => UI.showSoldToast(cat.name));
        } else {
          UI.showConfirm('无法出售', r.reason, '好的', () => {});
        }
      });
  },

  /** 免费送养确认：0金币、名声+1，轨道固定 80%正常/20%百万 */
  showAdoptFreeConfirm(cat) {
    UI.showConfirm('免费领养',
      '确认免费送养' + cat.name + '？它一定会去好人家。',
      '确认送养',
      () => {
        const r = Game.adoptFreeCat(cat.id);
        if (r.ok) {
          UI.closeModal();
          UI.render();
          UI.enqueueModal(() => UI.showSoldToast(cat.name, '已送养！'));
        } else {
          UI.showConfirm('无法送养', r.reason, '好的', () => {});
        }
      });
  },

  /* ---------- 成交提示（不透露命运结局） ---------- */

  showSoldToast(name, title) {
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">' + (title || '成交！') + '</div>' +
        '<p class="confirm-text">' + name + ' 去了新家。</p>' +
        '<button class="btn btn-primary btn-block" data-close>知道了</button>' +
      '</div>');
  },

  /* ---------- 粉丝高价求购 ---------- */

  showFanOffer(offer) {
    const cat = offer.cat;
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">🌟 粉丝高价求购</div>' +
        '<p class="confirm-text">一位粉丝专程找来，愿意出 <b>' + offer.price + '</b> 金币买走 ' + cat.name + '，卖吗？</p>' +
        '<div class="confirm-btns">' +
          '<button class="btn btn-ghost" data-close>不卖</button>' +
          '<button class="btn btn-primary btn-sm" id="btn-fan-sell">卖</button>' +
        '</div>' +
      '</div>');
    document.getElementById('btn-fan-sell').addEventListener('click', () => {
      const r = Game.sellToFan(cat.id, offer.price);
      UI.closeModal();
      UI.render();
      if (r.ok) UI.enqueueModal(() => UI.showSoldToast(cat.name, '粉丝接走了它'));
    });
  },

  /* ---------- 每月大事记（闯祸/老猫温情/新家来信，1-3条） ---------- */

  showDigest(month, items) {
    const rows = items.map(it =>
      '<div class="digest-item"><span class="digest-icon">' + it.icon + '</span><span>' + it.text + '</span></div>'
    ).join('');
    UI.openModal(
      '<div class="modal-card modal-event">' +
        '<div class="obit-title">' + UI.fmtDate(month) + ' · 猫舍大事记</div>' +
        '<div class="digest-list">' + rows + '</div>' +
        '<button class="btn btn-primary btn-block" data-close>知道了</button>' +
      '</div>');
  },

  /* ---------- 命运曝光卡（黑暗 / 百万富翁） ---------- */

  showFateReveal(rec, type) {
    if (type === 'dark') {
      UI.openModal(
        '<div class="modal-card modal-event">' +
          '<div class="event-icon">😱</div>' +
          '<div class="obit-title">坏消息</div>' +
          '<p class="event-text">有网友爆料，从你猫舍售出的 <b>' + rec.name + '</b> 遭遇不幸，帖子已经传开了。</p>' +
          '<div class="report-box report-danger">名声 ' + FATE.DARK_REVEAL_FAME + '</div>' +
          '<button class="btn btn-primary btn-block" data-close>知道了</button>' +
        '</div>');
    } else {
      UI.openModal(
        '<div class="modal-card modal-event">' +
          '<div class="event-icon">🎉</div>' +
          '<div class="obit-title">好消息</div>' +
          '<p class="event-text">有人拍到 <b>' + rec.name + '</b> 住进了带花园的大房子，网友都说它投了个好胎。</p>' +
          '<button class="btn btn-primary btn-block" data-close>太好了</button>' +
        '</div>');
    }
  },

  /* ---------- 告别卡（统一寿命系统：在舍/名册两种文案） ---------- */

  showFarewell(cat, cause, inCattery) {
    let body;
    if (inCattery) {
      const born = cat.birth >= 0 ? '它生于' + UI.fmtDate(cat.birth) : '它生于猫舍开业之前';
      body = cause + '。' + born + '，活了' + Cat.ageText(cat, Game.state.month) + '，一生留下' + (cat.offspring || 0) + '只后代。';
    } else {
      body = cat.name + '在新家离开了这个世界。' + cause + '。';
    }
    UI.openModal(
      '<div class="modal-card modal-obit">' +
        '<div class="obit-title">「' + cat.name + '离开了」</div>' +
        '<div class="obit">' +
          '<div class="obit-icon">🕯️</div>' +
          '<div>' +
            '<div class="obit-name">' + cat.name + '</div>' +
            '<div class="obit-text">' + body + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="obit-note">愿它在彩虹桥的那边依然快乐</div>' +
        '<button class="btn btn-primary btn-block" data-close>送别</button>' +
      '</div>');
  },

  /* ---------- 年度总结卡 ---------- */

  showYearSummary(d) {
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">第' + d.year + '年过去了</div>' +
        '<p class="confirm-text">这一年，' + d.born + ' 只小猫出生，' + d.sold + ' 只去了新家，' + d.died + ' 只离开了。猫舍现有 ' + d.alive + ' 只猫。</p>' +
        '<button class="btn btn-primary btn-block" data-close>继续</button>' +
      '</div>');
  },

  /* ---------- 开局卡（每个新存档仅首次） ---------- */

  showOpening() {
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">金故模拟器</div>' +
        '<p class="confirm-text">养猫不是一阵子的事，是一辈子的事。这间猫舍的七十年，现在开始。</p>' +
        '<button class="btn btn-primary btn-block" data-close>开始</button>' +
      '</div>');
  },

  /* ---------- 流浪求救强制抉择 ---------- */

  showRescueChoice(rec) {
    const s = Game.state;
    const canAfford = s.coins >= FATE.RESCUE_COST;
    UI.openModal(
      '<div class="modal-card modal-event">' +
        '<div class="event-icon">🆘</div>' +
        '<div class="obit-title">流浪求救</div>' +
        '<p class="event-text">你在同城流浪猫救助帖里看到了 <b>' + rec.name + '</b>，它瘦得脱了形。<br>花 ' + FATE.RESCUE_COST + ' 金币把它救回来吗？</p>' +
        (canAfford ? '' : '<div class="report-box report-warn">金币不足 ' + FATE.RESCUE_COST + '，无力救助</div>') +
        '<div class="confirm-btns">' +
          '<button class="btn btn-ghost" id="btn-decline-rescue">狠心离开</button>' +
          '<button class="btn btn-primary" id="btn-do-rescue"' + (canAfford ? '' : ' disabled') + '>救回来</button>' +
        '</div>' +
      '</div>');
    document.getElementById('btn-decline-rescue').addEventListener('click', () => {
      Game.declineRescue(rec);
      UI.closeModal();
      UI.render();
    });
    if (canAfford) {
      document.getElementById('btn-do-rescue').addEventListener('click', () => {
        const r = Game.rescueCat(rec);
        UI.closeModal();
        UI.render();
        if (r.ok) UI.enqueueModal(() => UI.showRescuedToast(r.cat.name));
      });
    }
  },

  showRescuedToast(name) {
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">欢迎回家</div>' +
        '<p class="confirm-text">' + name + ' 回到了猫舍。它瘦得脱了形，但在你的照顾下会一天天好起来。名声 +' + FATE.RESCUE_FAME + '</p>' +
        '<button class="btn btn-primary btn-block" data-close>知道了</button>' +
      '</div>');
  },

  /* ---------- 70年结算卡 ---------- */

  showFinalSettlement() {
    const s = Game.state;
    const r = Game.ratingOf(s.fame, s.coins);
    const soldCount = s.soldArchive.filter(x => x.how === 'sold' || x.how === 'transfer').length;
    const stat = (label, val) => '<div class="go-stat"><span>' + val + '</span>' + label + '</div>';
    UI.openModal(
      '<div class="modal-card modal-gameover">' +
        '<div class="go-title">🎓 70年经营期满</div>' +
        '<div class="go-rating">' + r.icon + ' ' + r.name + '</div>' +
        '<div class="go-stats">' +
          stat('繁育成活', (s.stats ? s.stats.born : 0) + ' 只') +
          stat('售出总数', soldCount + ' 只') +
          stat('善终', (s.stats ? s.stats.deaths : 0) + ' 只') +
          stat('救助', (s.stats ? s.stats.rescued : 0) + ' 只') +
          stat('最终名声', s.fame + '/100') +
          stat('最终金币', s.coins) +
        '</div>' +
        '<button class="btn btn-primary btn-block" id="btn-settle-thanks">查看结语</button>' +
      '</div>');
    document.getElementById('btn-settle-thanks').addEventListener('click', () => UI.showThanks());
  },

  /* ---------- 结局感谢页（仅70年结算可进；锁定弹窗，像一封安静的信） ---------- */

  showThanks() {
    const s = Game.state;
    const n = k => (s.stats && typeof s.stats[k] === 'number') ? s.stats[k] : 0;
    UI.openModal(
      '<div class="thanks-page">' +
        '<div class="thanks-letter">' +
          '<p class="thanks-lead">七十年，落幕了。</p>' +
          '<p>这一生，你迎接了 <b>' + n('born') + '</b> 只小猫来到这个世界，<br>' +
          '目送 <b>' + n('sold') + '</b> 只去了新的家，<br>' +
          '为 <b>' + n('natural') + '</b> 只养老送终，<br>' +
          '也曾把 <b>' + n('rescued') + '</b> 只流浪的孩子，重新接回怀里。</p>' +
          '<p>它们中的大多数，寿命不过十几年，注定先你而去。<br>' +
          '但你给过它们的名字、猫粮，和每一次三思而后行，都真实地发生过。</p>' +
          '<p>养猫从来不是一阵子的事，是一辈子的事。<br>' +
          '你用七十年，把这句话践行到了最后一个月。</p>' +
          '<p>感谢你，给予它们生命。<br>也感谢你，从未辜负它们。</p>' +
          '<p class="thanks-sign">—— 开山老祖 Maisie 与全体猫猫，敬上</p>' +
          '<p class="thanks-share-line">如果你也曾被某只猫照亮过，<br>请把这个游戏，分享给下一个爱猫的人。</p>' +
          '<div class="thanks-btns">' +
            '<button class="btn btn-primary" id="btn-thanks-restart">重新开始</button>' +
            '<button class="btn btn-ghost" id="btn-thanks-share">分享这份快乐</button>' +
          '</div>' +
          '<div class="thanks-tip" id="thanks-tip" hidden>把这个游戏文件夹整个发给你的朋友吧</div>' +
        '</div>' +
      '</div>');
    UI._modalLocked = true;
    document.getElementById('btn-thanks-restart').addEventListener('click', () => {
      Game.restart();
      UI._modalLocked = false;
      UI.closeModal();
      UI.render();
    });
    document.getElementById('btn-thanks-share').addEventListener('click', () => {
      // 本地文件环境没有可分享的链接，提示玩家直接分享整个文件夹
      if (location.protocol !== 'file:' && navigator.share) {
        navigator.share({ title: '金故模拟器', text: '一间猫舍的七十年，等你来书写。', url: location.href }).catch(() => {});
      } else {
        document.getElementById('thanks-tip').hidden = false;
      }
    });
  },

  /* ---------- 外部商场 ---------- */

  showMarket(msg, isErr) {
    const s = Game.state;
    const juv = Game.juvenileCount();
    const roomLeft = MARKET.JUVENILE_SLOTS - juv;

    const rows = s.market.map(m => {
      const coat = Genetics.coat(m);
      const price = Game.marketPriceOf(m);
      const canBuy = s.coins >= price && juv < MARKET.JUVENILE_SLOTS;
      // 名声 > 70 才能看懂九座基因卡
      const genesStr = s.fame > 70
        ? LOCI_ORDER.map(l => l + ' ' + m.genes[l].join('/')).join(' · ')
        : null;
      return '<div class="market-row">' +
        '<img class="avatar avatar-sm avatar-img" src="' + Cat.avatarSrc(m, s.month) + '" alt="">' +
        '<div class="market-info">' +
          '<div class="market-name">' + m.name + ' ' + (m.sex === 'M' ? '♂' : '♀') + (m.star ? ' ✨' : '') + '</div>' +
          '<div class="market-sub">' + Cat.ageText(m, s.month) + ' · ' + coat.name + '</div>' +
          '<div class="market-genes' + (genesStr ? '' : ' dim') + '">' + (genesStr || '基因卡 ？？？') + '</div>' +
        '</div>' +
        '<div class="market-buy">' +
          '<div class="market-price">💰 ' + price + '</div>' +
          '<button class="btn btn-primary btn-sm" data-buy="' + m.id + '"' + (canBuy ? '' : ' disabled') + '>购买</button>' +
        '</div>' +
      '</div>';
    }).join('');

    UI.openModal(
      '<div class="modal-card modal-market">' +
        '<button class="modal-close" data-close>✕</button>' +
        '<div class="modal-title">🛒 外部商场</div>' +
        '<div class="modal-sub">每月1日刷新 1-3 只 · 小猫栏位 ' + juv + '/' + MARKET.JUVENILE_SLOTS +
          '（月龄不足1岁的猫占用栏位） · 名声越高货源越好</div>' +
        (msg ? '<div class="market-msg' + (isErr ? ' err' : '') + '">' + msg + '</div>' : '') +
        '<div class="market-list">' +
          (rows || '<div class="empty">本月没有合适的猫，等下个月1日再来看看吧</div>') +
        '</div>' +
      '</div>');

    document.querySelectorAll('[data-buy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mkt = s.market.find(m => m.id === btn.dataset.buy);
        const r = Game.buyMarketCat(btn.dataset.buy);
        if (r.ok) {
          UI.render();
          UI.showMarket('已将 ' + mkt.name + ' 接回猫舍，花费 ' + r.price + ' 金币');
        } else {
          UI.showMarket(r.reason, true);
        }
      });
    });
  },

  /* ---------- 改名弹窗 ---------- */

  showRenameModal(cat) {
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">给「' + cat.name + '」改名</div>' +
        '<input class="rename-input" id="rename-input" maxlength="12" value="' + cat.name + '" placeholder="输入新名字">' +
        '<div class="confirm-btns">' +
          '<button class="btn btn-ghost" data-close>取消</button>' +
          '<button class="btn btn-primary btn-sm" id="btn-rename-ok">确认</button>' +
        '</div>' +
      '</div>');
    const input = document.getElementById('rename-input');
    input.focus();
    input.select();
    document.getElementById('btn-rename-ok').addEventListener('click', () => {
      if (Game.renameCat(cat.id, input.value)) {
        UI.render();
        UI.showCatModal(cat);   // 改名后回到详情页
      }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-rename-ok').click();
    });
  },

  /* ---------- 繁育配对弹窗 ---------- */

  showBreedModal(sel) {
    const s = Game.state;
    sel = sel || { sire: null, dam: null };

    const colHtml = role => {
      const sexWanted = role === 'sire' ? 'M' : 'F';
      const items = s.cats.filter(c => c.sex === sexWanted).map(c => {
        const chk = Game.canPair(c, role, s.month);
        const coat = Genetics.coat(c);
        const cls = 'breed-item' + (chk.ok ? '' : ' off') + (sel[role] === c.id ? ' sel' : '');
        return '<div class="' + cls + '" data-role="' + role + '" data-id="' + c.id + '">' +
          '<img class="avatar avatar-sm avatar-img" src="' + Cat.avatarSrc(c, s.month) + '" alt="">' +
          '<div class="breed-item-info">' +
            '<div class="breed-item-name">' + c.name + (c.star ? ' ✨' : '') + '</div>' +
            '<div class="breed-item-sub">' + Cat.ageText(c, s.month) + ' · ' + coat.name + '</div>' +
          '</div>' +
          (chk.ok ? '' : '<div class="breed-item-reason">' + chk.reason + '</div>') +
        '</div>';
      }).join('');
      return items || '<div class="empty">暂无可用猫咪</div>';
    };

    const noEnergy = s.energy < BREED.ENERGY_COST;
    UI.openModal(
      '<div class="modal-card modal-breed">' +
        '<button class="modal-close" data-close>✕</button>' +
        '<div class="modal-title">💕 繁育配对</div>' +
        '<div class="modal-sub">分别点选 1 只公猫和 1 只母猫（育龄 1-7 岁，满7岁退役，母猫需未怀孕且已过休养期）</div>' +
        '<div class="breed-cols">' +
          '<div class="breed-col"><h4>公猫</h4>' + colHtml('sire') + '</div>' +
          '<div class="breed-col"><h4>母猫</h4>' + colHtml('dam') + '</div>' +
        '</div>' +
        '<div class="breed-foot">' +
          '<span>当前精力：' + s.energy + '/' + CONFIG.ENERGY_MAX +
            (noEnergy ? '（精力不足，无法配对）' : '') + '</span>' +
          '<button class="btn btn-primary btn-sm" id="btn-to-report"' +
            ((sel.sire && sel.dam) ? '' : ' disabled') + '>❤ 近亲检查</button>' +
        '</div>' +
      '</div>');

    document.querySelectorAll('.breed-item:not(.off)').forEach(el => {
      el.addEventListener('click', () => {
        sel[el.dataset.role] = el.dataset.id;
        UI.showBreedModal(sel);
      });
    });
    const btn = document.getElementById('btn-to-report');
    if (btn && sel.sire && sel.dam) {
      btn.addEventListener('click', () => UI.showInbreedReport(sel.sire, sel.dam));
    }
  },

  /* ---------- 近亲检查报告 ---------- */

  showInbreedReport(sireId, damId) {
    const s = Game.state;
    const sire = s.cats.find(c => c.id === sireId);
    const dam = s.cats.find(c => c.id === damId);
    if (!sire || !dam) return UI.closeModal();

    const d = Game.inbreedCheck(sireId, damId);
    let cls, text;
    if (d === 1)      { cls = 'report-danger'; text = '1代血亲！这窝小猫将全部夭折，名声-5'; }
    else if (d === 2) { cls = 'report-warn';   text = '2代血亲：成活率降至60%，畸形率+30%，名声-3'; }
    else if (d === 3) { cls = 'report-info';   text = '3代血亲：成活率降至80%，畸形率+10%，名声-1'; }
    else              { cls = 'report-safe';   text = '血缘安全，可以配对'; }

    const noEnergy = s.energy < BREED.ENERGY_COST;
    UI.openModal(
      '<div class="modal-card modal-report">' +
        '<div class="modal-title">近亲检查报告</div>' +
        '<div class="report-pair">' + sire.name + ' ♂ × ♀ ' + dam.name + '</div>' +
        '<div class="report-box ' + cls + '">' + text + '</div>' +
        (noEnergy ? '<div class="report-box report-warn">当前精力不足 1 点，无法配对</div>' : '') +
        '<div class="confirm-btns">' +
          '<button class="btn btn-ghost" id="btn-back-breed">返回重选</button>' +
          '<button class="btn ' + (d === 1 ? 'btn-danger' : 'btn-primary') + '" id="btn-do-breed"' +
            (noEnergy ? ' disabled' : '') + '>' + (d === 1 ? '执意执行' : '确认配对') + '</button>' +
        '</div>' +
      '</div>');

    document.getElementById('btn-back-breed').addEventListener('click', () => {
      UI.showBreedModal({ sire: sireId, dam: damId });
    });
    const doBtn = document.getElementById('btn-do-breed');
    if (!noEnergy) {
      doBtn.addEventListener('click', () => {
        if (Game.breed(sireId, damId)) {
          UI.closeModal();
          UI.render();
        }
      });
    }
  },

  /* ---------- 产窝结算弹窗 ---------- */

  showLitter(res) {
    const kittensHtml = res.kittens.length
      ? '<div class="kitten-list">' + res.kittens.map(k => {
          const coat = Genetics.coat(k);
          return '<div class="kitten-row">' +
            '<img class="avatar avatar-sm avatar-img" src="' + Cat.avatarSrc(k, Game.state.month) + '" alt="">' +
            '<div class="kitten-info">' +
              '<div class="kitten-name">' + k.name + ' ' + (k.sex === 'M' ? '♂' : '♀') + (k.star ? ' ✨顶流' : '') + '</div>' +
              '<div class="kitten-sub">' + coat.name + ' · ' + k.personality.join('、') + ' · ' + k.health + '</div>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>'
      : '<div class="empty">这窝小猫全部夭折了…</div>';

    UI.openModal(
      '<div class="modal-card modal-litter">' +
        '<div class="obit-title">🍼 ' + res.damName + ' 分娩了！</div>' +
        '<div class="modal-sub litter-sire">父亲：' + res.sireName + '</div>' +
        '<div class="litter-stats">' +
          '<span>共产 ' + res.size + ' 只</span>' +
          '<span class="ok">成活 ' + res.kittens.length + '</span>' +
          '<span class="bad">夭折 ' + res.stillborn + '</span>' +
        '</div>' +
        (res.d ? '<div class="report-box ' + (res.d === 1 ? 'report-danger' : res.d === 2 ? 'report-warn' : 'report-info') +
          '">近亲繁育：名声 ' + BREED.INBREED_FAME[res.d] + '</div>' : '') +
        kittensHtml +
        '<button class="btn btn-primary btn-block" data-close>知道了</button>' +
      '</div>');
  },

  /* ---------- 坏结局：猫舍倒闭 ---------- */

  showGameOver() {
    const s = Game.state;
    UI.openModal(
      '<div class="modal-card modal-gameover">' +
        '<div class="go-title">😿 猫舍倒闭了</div>' +
        '<div class="go-text">金币透支，房租和猫粮账单压垮了这家小店。' +
        '猫咪们已被妥善安置到新家，感谢一起走过的日子。</div>' +
        '<div class="go-stats">' +
          '<div class="go-stat"><span>' + Math.floor(s.month / 12) + '年' + (s.month % 12) + '个月</span>经营时长</div>' +
          '<div class="go-stat"><span>' + (s.stats ? s.stats.born : 0) + ' 只</span>累计繁育成活</div>' +
          '<div class="go-stat"><span>' + (s.soldArchive ? s.soldArchive.length : 0) + ' 只</span>已售出名册</div>' +
        '</div>' +
        '<button class="btn btn-primary btn-block" id="btn-go-restart">重新开始</button>' +
      '</div>');
    document.getElementById('btn-go-restart').addEventListener('click', () => {
      Game.restart();
      UI.closeModal();
      UI.render();
    });
  },

  /* ---------- 重新开始确认 ---------- */

  showRestartConfirm() {
    UI.openModal(
      '<div class="modal-card modal-confirm">' +
        '<div class="modal-title">重新开始</div>' +
        '<p class="confirm-text">确定要重新开始吗？当前存档将被永久清除。</p>' +
        '<div class="confirm-btns">' +
          '<button class="btn btn-ghost" data-close>取消</button>' +
          '<button class="btn btn-danger" id="btn-confirm-restart">确定重开</button>' +
        '</div>' +
      '</div>');
    document.getElementById('btn-confirm-restart').addEventListener('click', () => {
      Game.restart();
      UI.closeModal();
      UI.render();
    });
  },
};

UI.init();
