// ---------------------------------------------------------------------------
// السيناريو — story, direction and cutscenes.
//
// Every line carries an emotion, which the dialogue director turns into
// prosody plus non-verbal acting (breaths, sobs, screams). Cutscenes are shot
// lists: set a shot, play dialogue over it, cut.
// ---------------------------------------------------------------------------

const K = (text, emo = 'calm', hold) => ({ who: 'karim', text, emo, hold });
const L = (text, emo = 'calm', hold) => ({ who: 'layla', text, emo, hold });
const S = (text, emo = 'cold', hold) => ({ who: 'shepherd', text, emo, hold });
const N = (text, emo = 'soft', hold) => ({ who: 'narrator', text, emo, hold });

export const STORY = {
  // -------------------------------------------------------------------------
  road: {
    ambient: [
      K('هذا المطر لا يريد أن يتوقف.', 'soft'),
      L('بابا، قدماي تؤلمانني.', 'soft'),
      K('لا تبتعدي عني يا ليلى.', 'tense'),
    ],

    async start(ctx) {
      ctx.setObjective('اتبع الطريق إلى باب البيت');
      await ctx.openingCinematic();
    },

    triggers: {
      '!': async (ctx) => {
        await ctx.say([
          L('بابا… لماذا كل النوافذ مسمّرة من الداخل؟', 'afraid'),
          K('لأنه بيت قديم ومهجور. لا شيء أكثر من ذلك.', 'soft'),
          L('إذاً لماذا هناك ضوء في الطابق العلوي؟', 'afraid'),
        ]);
        ctx.setObjective('ابحث في السقيفة ثم اصعد إلى الشرفة');
      },
      '?': async (ctx) => {
        await ctx.say([
          K('الباب الأمامي مفتوح…', 'tense'),
          K('لم يكن مفتوحاً قبل قليل.', 'afraid'),
        ]);
        ctx.audio.stinger('shock');
        await ctx.say([
          S('ادخل. أنا في انتظاركما منذ زمن طويل.', 'cold'),
          L('بابا؟ من قال ذلك؟', 'afraid'),
          K('…لا أحد. ادخلي بسرعة.', 'tense'),
        ]);
      },
    },

    async onPickup(item, ctx) {
      if (item.kind === 'flashlight') {
        ctx.player.hasFlashlight = true;
        ctx.player.flashlightOn = true;
        await ctx.say([K('كشّاف. الحمد لله.', 'soft')]);
        ctx.hint('F لتشغيل الكشّاف وإطفائه');
      }
    },

    complete: (ctx) => ctx.flags.has('reachedExit'),
  },

  // -------------------------------------------------------------------------
  foyer: {
    ambient: [
      L('بابا، أسمع أحداً يمشي فوقنا.', 'afraid'),
      K('الغبار هنا لم يُلمس منذ سنوات.', 'soft'),
      L('لا أحب هذا المكان.', 'afraid'),
      K('ابقي قريبة.', 'tense'),
    ],

    async start(ctx) {
      ctx.setObjective('ابحث عن ثلاثة مصاهر وأعد الكهرباء');
      await ctx.say([
        K('أُغلق الباب خلفنا…', 'tense'),
        L('بابا، أنا خائفة.', 'afraid'),
        K('لا بأس. الريح فقط. ابحثي معي عن هاتف أو لوحة كهرباء.', 'soft'),
      ]);

      // first contact with the voice in the walls — a short held shot
      await ctx.villainReveal();

      ctx.hint('E للتفاعل · اجمع المصاهر الثلاثة');
    },

    triggers: {
      '*': async (ctx) => {
        if (ctx.flags.has('firstMonster')) return;
        ctx.flags.add('firstMonster');
        ctx.audio.stinger('shock');
        ctx.shake(0.8);
        ctx.wakeEnemies(2);
        ctx.giveWeapon('axe');
        await ctx.say([
          K('يا الله… ما هذا الشيء؟!', 'scream'),
          L('بابا! خلفك!', 'scream'),
          K('اختبئي! اختبئي الآن!', 'angry'),
        ]);
        ctx.hint('زر الفأرة الأيسر للضرب · 2 للفأس');
      },
      $: async (ctx) => {
        await ctx.say([
          K('صور… كلها لعائلات. وكلها ممزقة عند وجه الأب.', 'tense'),
          S('كلهم جرّبوا ما ستجرّبه. كلهم بكوا في النهاية.', 'mock'),
        ]);
      },
      '&': async (ctx) => {
        await ctx.say([K('لوحة الكهرباء. ثلاثة مصاهر ناقصة.', 'calm')]);
      },
    },

    async onPickup(item, ctx) {
      ctx.flags.add(`fuse${ctx.pickedFuses}`);
      if (ctx.pickedFuses === 1) {
        ctx.wakeEnemies(1);
        await ctx.say([K('مصهر واحد. باقي اثنان.', 'tense')]);
      } else if (ctx.pickedFuses === 2) {
        ctx.wakeEnemies(1);
        await ctx.say([K('الثاني. أوشكت.', 'tense'), L('بابا، أسرع أرجوك.', 'afraid')]);
      } else {
        ctx.wakeEnemies(2);
        await ctx.say([K('الثالث! هيا إلى اللوحة.', 'tense')]);
        ctx.setObjective('عد إلى لوحة الكهرباء عند بسطة القبو');
      }
    },

    async onInteract(target, ctx) {
      if (target.kind !== 'fuseBox') return;
      if (ctx.pickedFuses < 3) {
        ctx.hud.showToast('ما زلت بحاجة إلى مصاهر');
        return;
      }
      ctx.audio.lever();
      ctx.flags.add('powerOn');
      ctx.powerOn();
      ctx.openExit();
      ctx.setObjective('انزل إلى القبو');
      await ctx.say([
        K('هيا… اشتغل…', 'tense'),
        S('نور؟ كم هذا لطيف. الآن أستطيع أن أراكما جيداً.', 'mock'),
        K('الباب انفتح. القبو… لا خيار آخر.', 'tense'),
      ]);
    },

    complete: (ctx) => ctx.flags.has('reachedExit'),
  },

  // -------------------------------------------------------------------------
  basement: {
    ambient: [
      L('الماء بارد يا بابا.', 'afraid'),
      K('لا تتركي يدي.', 'tense'),
      K('هناك شيء يتحرك في الماء.', 'afraid'),
    ],

    async start(ctx) {
      ctx.setObjective('أدر الصمامات الثلاثة لتصريف المياه');
      await ctx.say([
        K('الماء يصل إلى الركبة. انتبهي لخطواتك.', 'tense'),
        L('بابا، لماذا يوجد أقفاص هنا؟', 'afraid'),
        K('لا تنظري إليها. انظري إلى ظهري فقط.', 'tense'),
        S('ثلاثة صمامات يا كريم. ثلاث فرصٍ لتغيّر رأيك.', 'cold'),
        S('اخرج وحدك… واتركها لي. وسأفتح لك الباب بنفسي.', 'cold'),
        K('لن تلمسها. ولو كان آخر شيء أفعله.', 'angry'),
        S('سنرى.', 'mock'),
      ]);
    },

    triggers: {
      '?': async (ctx) => {
        ctx.wakeEnemies(2);
        ctx.audio.stinger('shock');
        await ctx.say([K('إنها تسبح تحت الماء… ابتعدي عن الحافة!', 'scream')]);
      },
    },

    async onInteract(target, ctx) {
      if (target.kind !== 'valve' || target.used) return;
      target.used = true;
      ctx.audio.lever();
      ctx.flags.add(`valve${ctx.usedValves}`);
      ctx.wakeEnemies(2);
      if (ctx.usedValves < 3) {
        await ctx.say([K(`صمام ${ctx.usedValves} من ٣.`, 'tense')]);
        ctx.setObjective(`أدر الصمامات (${ctx.usedValves}/٣)`);
      } else {
        ctx.drainWater();
        ctx.openExit();
        await ctx.say([K('الماء ينسحب! هيا يا ليلى، البا…', 'tense')]);
        await ctx.abduction();
      }
    },

    complete: (ctx) => ctx.flags.has('reachedExit'),
  },

  // -------------------------------------------------------------------------
  chapel: {
    ambient: [K('ليلى! أين أنتِ؟!', 'scream')],

    async start(ctx) {
      ctx.setObjective('اعثر على ليلى');
      await ctx.say([
        K('ليلى! أنا قادم! اصمدي يا حبيبتي!', 'scream'),
        S('لا تركض. ستفوّت على نفسك المتعة.', 'mock'),
      ]);
    },

    triggers: {
      '!': async (ctx) => {
        await ctx.say([
          K('شموع… كأن أحداً كان ينتظر هذه الليلة.', 'tense'),
          S('ليس أحداً. أنا.', 'cold'),
        ]);
      },
      '?': async (ctx) => {
        if (ctx.flags.has('sceneDone')) return;
        ctx.flags.add('sceneDone');
        await STORY.chapel.altarScene(ctx);
      },
    },

    // =====================================================================
    // المشهد المحوري — the altar. Ten shots.
    // =====================================================================
    async altarScene(ctx) {
      const { audio, cine, at } = ctx;
      cine.begin();
      ctx.sealDoors();
      ctx.setObjective('');
      audio.door(false);

      const boss = ctx.spawnBoss();
      const layla = ctx.companion;
      ctx.avatar('stand', ctx.player.position, 0);

      // 1 — ESTABLISHING: the whole nave, pushing slowly toward the altar
      cine.shot({
        pos: at(16, 12, 4.4), posTo: at(16, 10, 3.2),
        look: at(16, 5, 1.7),
        fov: 52, fovTo: 44, dur: 7, ease: 'creep', handheld: 0.3,
      });
      await ctx.wait(2.2);
      await ctx.say([S('على مهلك يا كريم. لقد وصلتَ في الوقت المناسب تماماً.', 'mock')]);

      // 2 — THE SHEPHERD: low, close, looking up at him
      cine.shot({
        pos: at(16, 7, 0.9), posTo: at(16, 6.6, 1.0),
        look: boss.mesh, follow: true,
        fov: 34, dur: 5, handheld: 0.55, focus: 3.2, aperture: 0.45, roll: 0.03,
      });
      await ctx.wait(1.4);

      // 3 — LAYLA: shallow focus, she fills the frame
      if (layla) {
        cine.shot({
          pos: at(18.2, 7, 1.15),
          look: { anchor: layla.mesh, offset: [0, 0.95, 0] }, follow: true,
          fov: 40, dur: 4, handheld: 0.45, focus: 2.0, aperture: 0.3,
        });
      }
      await ctx.say([
        L('بابا… أنا خائفة.', 'afraid'),
        K('لا تنظري إليه يا حبيبتي. انظري إليّ أنا. انظري إليّ فقط.', 'plead'),
      ]);

      // 4 — OVER THE SHOULDER: Karim on his feet, arms out, begging
      ctx.avatar('plead');
      cine.shot({
        pos: at(14.8, 9.4, 1.85), posTo: at(15.1, 9.0, 1.8),
        look: at(16, 5.4, 1.6),
        fov: 46, dur: 6, handheld: 0.5, focus: 6.5, aperture: 0.8,
      });
      await ctx.say([
        K('دعها تذهب. خذني أنا. أتوسل إليك… خذني أنا وحدي.', 'plead'),
        S('كلهم يقولون هذا. كلهم يظنون أن التوسّل عملة.', 'cold'),
        S('هذا هو الجزء الذي أحبّه: اللحظة التي يفهم فيها الأب…', 'mock'),
      ]);

      // 5 — THE PUSH IN before the blow
      cine.shot({
        pos: at(16, 8.4, 1.5), posTo: at(16, 7.4, 1.5),
        look: at(16, 5, 1.7),
        fov: 40, fovTo: 30, dur: 3.2, ease: 'in', handheld: 0.7,
      });
      await ctx.say([S('…أنه لا يستطيع أن يفعل شيئاً.', 'cold')]);
      await ctx.say([K('لا. لا لا لا — لا تفعل! لااااا!', 'scream')]);

      // 6 — THE CUT TO BLACK. We hear it; we don't watch it.
      ctx.blackout(true);
      audio.stinger('shock');
      audio.impact(true);
      ctx.shake(1.6);
      await ctx.wait(0.5);
      ctx.killCompanion();
      ctx.vocals?.scream('layla', { dur: 0.7, intensity: 0.9 });
      await ctx.wait(1.5);
      await ctx.say([L('…بابا.', 'whisper')]);
      await ctx.wait(1.8);

      // 7 — AFTERMATH: he is already on his knees when the light comes back
      ctx.avatar('kneel');
      cine.slowmo(0.45);
      cine.desaturate(0.65);
      ctx.grief(true);
      audio.stinger('grief');
      cine.shot({
        pos: at(16, 9.2, 0.85), posTo: at(16, 8.6, 0.8),
        look: at(16, 6.2, 0.5),
        fov: 44, dur: 9, ease: 'creep', handheld: 0.28, focus: 4.0, aperture: 0.55,
      });
      ctx.blackout(false, 2.4);
      await ctx.wait(2.6);

      await ctx.say([
        K('ليلى…', 'cry'),
        K('ليلى، افتحي عينيكِ. أرجوكِ… افتحي عينيكِ يا حبيبتي.', 'cry'),
      ]);

      // 8 — HER: the slowest move in the game
      if (layla) {
        cine.shot({
          pos: { anchor: layla.mesh, offset: [1.5, 0.75, 1.3] },
          posTo: { anchor: layla.mesh, offset: [1.05, 0.55, 0.95] },
          look: { anchor: layla.mesh, offset: [0, 0.25, 0] },
          fov: 42, dur: 12, ease: 'creep', handheld: 0.2, focus: 1.7, aperture: 0.28,
        });
      }
      await ctx.say([
        K('أنا هنا. بابا هنا. قومي… قومي أرجوكِ…', 'cry'),
        K('أنا آسف. أنا آسف. أنا آسف يا ليلى…', 'cry'),
      ]);

      // 9 — THE LAUGH: dutch angle, low, backlit by the candles
      cine.slowmo(1);
      cine.shot({
        pos: at(16, 7.2, 0.55),
        look: boss.mesh, follow: true,
        fov: 32, dur: 5, handheld: 0.6, roll: 0.075, focus: 3.0, aperture: 0.5,
      });
      ctx.laugh();
      await ctx.wait(1.4);
      await ctx.say([
        S('ابكِ. ابكِ أكثر.', 'mock'),
        S('البكاء هو أجمل صوتٍ في هذا البيت. لا شيء يعلو عليه.', 'cold'),
        S('والآن اخرج. اترك جثتها لي واخرج، فأنا لا أقتل الآباء…', 'cold'),
        S('…أنا أتركهم يعيشون.', 'mock'),
      ]);

      // 10 — THE TURN: back on Karim as he stands up
      cine.desaturate(0);
      ctx.grief(false);
      ctx.avatar('rise');
      cine.shot({
        pos: at(16.9, 8.0, 1.45), posTo: at(16.6, 7.7, 1.55),
        look: { anchor: ctx.avatarObject(), offset: [0, 1.55, 0] }, follow: true,
        fov: 38, dur: 7, ease: 'out', handheld: 0.42, focus: 1.5, aperture: 0.3,
      });
      await ctx.wait(1.0);
      await ctx.say([
        K('لا.', 'cold'),
        K('لن أخرج.', 'cold'),
        K('سأقتلك.', 'angry'),
        S('…أخيراً.', 'cold'),
        S('أخيراً أصبحتَ مسلّياً يا كريم.', 'mock'),
      ]);
      ctx.laugh();
      await ctx.wait(1.2);
      ctx.vanishBoss();
      ctx.shake(1.2);
      await ctx.say([K('أينما ذهبت… سأجدك.', 'angry')]);

      // hand control back
      cine.focus(0);
      cine.end();
      ctx.hideAvatar();
      ctx.rage();
      ctx.giveWeapon('shotgun', 24);
      ctx.setObjective('اتبعه. لا شيء آخر يهم الآن.');
      ctx.openExit();
      ctx.unsealDoors();
    },

    complete: (ctx) => ctx.flags.has('reachedExit'),
  },

  // -------------------------------------------------------------------------
  revenge: {
    ambient: [
      K('اخرج! اخرج أيها الجبان!', 'angry'),
      K('لن أتعب قبلك.', 'angry'),
    ],

    async start(ctx) {
      ctx.setObjective('اقتل الراعي');
      await ctx.say([K('لا مزيد من الهرب.', 'angry')]);
    },

    triggers: {
      '!': async (ctx) => {
        if (ctx.flags.has('bossStarted')) return;
        ctx.flags.add('bossStarted');
        await STORY.revenge.bossIntro(ctx);
      },
    },

    // ---- boss entrance --------------------------------------------------
    async bossIntro(ctx) {
      const { cine, at } = ctx;
      cine.begin();
      const boss = ctx.spawnBoss();
      boss.state = 'idle';
      ctx.avatar('stand', ctx.player.position, 0);
      ctx.audio.stinger('rage');

      cine.shot({
        pos: at(15, 16, 5.6), posTo: at(15, 13, 3.0),
        look: boss.mesh, follow: true,
        fov: 50, fovTo: 38, dur: 5.5, ease: 'creep', handheld: 0.35,
      });
      await ctx.say([
        S('أنت غاضب. جيد.', 'mock'),
        S('الغضب يجعل اللحم أطيب.', 'cold'),
      ]);

      cine.shot({
        pos: { anchor: ctx.avatarObject(), offset: [1.2, 1.6, 1.4] },
        look: { anchor: ctx.avatarObject(), offset: [0, 1.5, 0] }, follow: true,
        fov: 36, dur: 3.2, handheld: 0.5, focus: 1.9, aperture: 0.3,
      });
      await ctx.say([K('هذا من أجل ليلى.', 'angry')]);

      cine.focus(0);
      cine.end();
      ctx.hideAvatar();
      boss.state = 'chase';
    },

    async onBossPhase(phase, ctx) {
      if (phase === 2) {
        await ctx.say([
          S('أتظن أن الرصاص يوجع من مات مرتين؟', 'mock'),
          K('سأكتشف ذلك.', 'angry'),
        ]);
      } else if (phase === 3) {
        await ctx.say([
          S('كفى لعباً!', 'angry'),
          K('نعم. كفى.', 'cold'),
        ]);
      }
    },

    async onBossDeath(ctx) {
      const { cine, at } = ctx;
      cine.begin();
      cine.slowmo(0.35);
      ctx.audio.stinger('grief');

      const boss = ctx.bossObject();
      if (boss) {
        cine.shot({
          pos: { anchor: boss.mesh, offset: [2.2, 1.4, 2.2] },
          posTo: { anchor: boss.mesh, offset: [1.7, 0.9, 1.7] },
          look: { anchor: boss.mesh, offset: [0, 0.6, 0] }, follow: true,
          fov: 40, dur: 6, ease: 'out', handheld: 0.45, focus: 2.6, aperture: 0.35,
        });
      }
      await ctx.say([
        S('هذا البيت… لن يدعك تخرج…', 'hurt'),
        S('لن يدعك…', 'hurt'),
      ]);

      cine.slowmo(1);
      ctx.avatar('kneel', ctx.player.position, 0);
      cine.shot({
        pos: { anchor: ctx.avatarObject(), offset: [1.6, 1.2, 1.8] },
        look: { anchor: ctx.avatarObject(), offset: [0, 1.0, 0] }, follow: true,
        fov: 42, dur: 5, handheld: 0.3, focus: 2.2, aperture: 0.4,
      });
      await ctx.say([
        K('لا يهم.', 'soft'),
        K('لم أعد أريد الخروج.', 'cry'),
      ]);

      // final crane: up and away, through the embers
      cine.shot({
        pos: { anchor: ctx.avatarObject(), offset: [1.6, 1.2, 1.8] },
        posTo: at(15, 15, 14),
        look: { anchor: ctx.avatarObject(), offset: [0, 1.0, 0] }, follow: true,
        fov: 42, fovTo: 58, dur: 9, ease: 'inOut', handheld: 0.25,
      });
      await ctx.wait(2.5);
      await ctx.ending();
      cine.end();
    },

    complete: (ctx) => ctx.flags.has('ending'),
  },
};

export const ENDING_LINES = [
  N('خرج كريم من البيت عند الفجر، وابنته بين ذراعيه.', 'soft'),
  N('لم يخبر أحداً بما رآه. ولم يعد أحدٌ يسمع صوت ضحكٍ في ذلك الطريق.', 'soft'),
  N('لكن في كل ليلة مطر… يقف على الطريق، وينتظر أن يضيع أحدهم.', 'cold'),
  K('ليلى… انتهى الأمر. نامي الآن.', 'cry'),
];

export const LAUGH_LINES = [
  'هههههههه.',
  'ما زلتَ حيّاً؟ كم هذا مؤسف.',
  'اركض. الركض يجعل الأمر أطول.',
  'هل تسمع؟ إنها تناديك.',
];
