// ---------------------------------------------------------------------------
// السيناريو — the story layer.
//
// Each chapter exposes lifecycle hooks the game loop calls. Everything that is
// spoken goes through ctx.say() so it is voiced *and* subtitled.
// ---------------------------------------------------------------------------

const K = (text, hold) => ({ who: 'karim', text, hold });
const L = (text, hold) => ({ who: 'layla', text, hold });
const S = (text, hold) => ({ who: 'shepherd', text, hold });
const N = (text, hold) => ({ who: 'narrator', text, hold });

export const STORY = {
  // -------------------------------------------------------------------------
  road: {
    ambient: [
      K('هذا المطر لا يريد أن يتوقف.'),
      L('بابا، قدماي تؤلمانني.'),
      K('لا تبتعدي عني يا ليلى.'),
    ],
    async start(ctx) {
      ctx.setObjective('اتبع الطريق إلى باب البيت');
      await ctx.say([
        N('في ليلة مطرٍ لا ينتهي، تعطّلت سيارةٌ على طريقٍ لا يمرّ به أحد.'),
        K('حسناً… المحرك مات تماماً.'),
        L('بابا، أين نحن؟'),
        K('لا أعرف يا حبيبتي. لكن هناك بيت. سنطلب المساعدة ونعود.'),
        L('البيت مظلم. لا أحد فيه.'),
        K('ابقي خلفي وامسكي يدي. لن يحدث لكِ شيء. أعدكِ.'),
      ]);
      ctx.hint('W A S D للحركة · الفأرة للنظر · Shift للركض');
    },
    triggers: {
      '!': async (ctx) => {
        await ctx.say([
          L('بابا… لماذا كل النوافذ مسمّرة من الداخل؟'),
          K('لأنه بيت قديم ومهجور. لا شيء أكثر من ذلك.'),
          L('إذاً لماذا هناك ضوء في الطابق العلوي؟'),
        ]);
        ctx.setObjective('ابحث في السقيفة ثم اصعد إلى الشرفة');
      },
      '?': async (ctx) => {
        await ctx.say([
          K('الباب الأمامي مفتوح…'),
          K('لم يكن مفتوحاً قبل قليل.'),
          S('ادخل. أنا في انتظاركما منذ زمن طويل.'),
          L('بابا؟ من قال ذلك؟'),
          K('…لا أحد. ادخلي بسرعة.'),
        ]);
      },
    },
    async onPickup(item, ctx) {
      if (item.kind === 'flashlight') {
        ctx.player.hasFlashlight = true;
        ctx.player.flashlightOn = true;
        await ctx.say([K('كشّاف. الحمد لله.')]);
        ctx.hint('F لتشغيل الكشّاف وإطفائه');
      }
    },
    complete: (ctx) => ctx.flags.has('reachedExit'),
  },

  // -------------------------------------------------------------------------
  foyer: {
    ambient: [
      L('بابا، أسمع أحداً يمشي فوقنا.'),
      K('الغبار هنا لم يُلمس منذ سنوات.'),
      L('لا أحب هذا المكان.'),
      K('ابقي قريبة.'),
    ],
    async start(ctx) {
      ctx.setObjective('ابحث عن ثلاثة مصاهر وأعد الكهرباء');
      await ctx.say([
        K('أُغلق الباب خلفنا…'),
        L('بابا، أنا خائفة.'),
        K('لا بأس. الريح فقط. ابحثي معي عن هاتف أو لوحة كهرباء.'),
        S('أهلاً بك في بيتي يا كريم.'),
        K('من أنت؟! كيف تعرف اسمي؟'),
        S('أنا أعرف كل من يدخل… وكل من لا يخرج.'),
        S('وأشكرك. لقد أحضرتَ لي هديّةً صغيرة.'),
        K('ابتعد عنها! هل تسمعني؟! ابتعد عنها!'),
      ]);
      ctx.hint('E للتفاعل · اجمع المصاهر الثلاثة');
    },
    triggers: {
      '*': async (ctx) => {
        if (ctx.flags.has('firstMonster')) return;
        ctx.flags.add('firstMonster');
        ctx.audio.stinger('shock');
        ctx.wakeEnemies(2);
        await ctx.say([
          K('يا الله… ما هذا الشيء؟!'),
          L('بابا! خلفك!'),
          K('اختبئي! اختبئي الآن!'),
        ]);
        ctx.giveWeapon('axe');
        ctx.hint('زر الفأرة الأيسر للضرب · 2 للفأس');
      },
      $: async (ctx) => {
        await ctx.say([
          K('صور… كلها لعائلات. وكلها ممزقة عند وجه الأب.'),
          S('كلهم جرّبوا ما ستجرّبه. كلهم بكوا في النهاية.'),
        ]);
      },
      '&': async (ctx) => {
        await ctx.say([K('لوحة الكهرباء. ثلاثة مصاهر ناقصة.')]);
      },
    },
    async onPickup(item, ctx) {
      ctx.flags.add(`fuse${ctx.pickedFuses}`);
      if (ctx.pickedFuses === 1) {
        ctx.wakeEnemies(1);
        await ctx.say([K('مصهر واحد. باقي اثنان.')]);
      } else if (ctx.pickedFuses === 2) {
        ctx.wakeEnemies(1);
        await ctx.say([K('الثاني. أوشكت.'), L('بابا، أسرع أرجوك.')]);
      } else {
        ctx.wakeEnemies(2);
        await ctx.say([K('الثالث! هيا إلى اللوحة.')]);
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
      // unlock the way forward before the dialogue, never after it
      ctx.openExit();
      ctx.setObjective('انزل إلى القبو');
      await ctx.say([
        K('هيا… اشتغل…'),
        S('نور؟ كم هذا لطيف. الآن أستطيع أن أراكما جيداً.'),
        K('الباب انفتح. القبو… لا خيار آخر.'),
      ]);
    },
    complete: (ctx) => ctx.flags.has('reachedExit'),
  },

  // -------------------------------------------------------------------------
  basement: {
    ambient: [
      L('الماء بارد يا بابا.'),
      K('لا تتركي يدي.'),
      K('هناك شيء يتحرك في الماء.'),
    ],
    async start(ctx) {
      ctx.setObjective('أدر الصمامات الثلاثة لتصريف المياه');
      await ctx.say([
        K('الماء يصل إلى الركبة. انتبهي لخطواتك.'),
        L('بابا، لماذا يوجد أقفاص هنا؟'),
        K('لا تنظري إليها. انظري إلى ظهري فقط.'),
        S('ثلاثة صمامات يا كريم. ثلاث فرصٍ لتغيّر رأيك.'),
        S('اخرج وحدك… واتركها لي. وسأفتح لك الباب بنفسي.'),
        K('لن تلمسها. ولو كان آخر شيء أفعله.'),
        S('سنرى.'),
      ]);
    },
    triggers: {
      '?': async (ctx) => {
        ctx.wakeEnemies(2);
        await ctx.say([K('إنها تسبح تحت الماء… ابتعدي عن الحافة!')]);
      },
    },
    async onInteract(target, ctx) {
      if (target.kind !== 'valve' || target.used) return;
      target.used = true;
      ctx.audio.lever();
      ctx.flags.add(`valve${ctx.usedValves}`);
      ctx.wakeEnemies(2);
      if (ctx.usedValves < 3) {
        await ctx.say([K(`صمام ${ctx.usedValves} من ٣.`)]);
        ctx.setObjective(`أدر الصمامات (${ctx.usedValves}/٣)`);
      } else {
        ctx.drainWater();
        ctx.openExit();
        await ctx.say([K('الماء ينسحب! هيا يا ليلى، البا…')]);
        await ctx.abduction();
      }
    },
    complete: (ctx) => ctx.flags.has('reachedExit'),
  },

  // -------------------------------------------------------------------------
  // الفصل المحوري: مشهد المذبح
  chapel: {
    ambient: [K('ليلى! أين أنتِ؟!')],
    async start(ctx) {
      ctx.setObjective('اعثر على ليلى');
      await ctx.say([
        K('ليلى! أنا قادم! اصمدي يا حبيبتي!'),
        S('لا تركض. ستفوّت على نفسك المتعة.'),
      ]);
    },
    triggers: {
      '!': async (ctx) => {
        await ctx.say([
          K('شموع… كأن أحداً كان ينتظر هذه الليلة.'),
          S('ليس أحداً. أنا.'),
        ]);
      },
      '?': async (ctx) => {
        if (ctx.flags.has('sceneDone')) return;
        ctx.flags.add('sceneDone');
        await STORY.chapel.altarScene(ctx);
      },
    },

    // ---- المشهد المحوري -----------------------------------------------------
    async altarScene(ctx) {
      const { audio, voice } = ctx;
      ctx.lockPlayer(true);
      ctx.sealDoors();
      audio.door(false);
      ctx.setObjective('');

      const boss = ctx.spawnBoss();
      const layla = ctx.companion;
      const lookAtLayla = (seconds) => { if (layla) ctx.focusOn(layla.mesh, seconds); };
      ctx.focusOn(boss.mesh, 2.6);

      await ctx.say([
        S('على مهلك يا كريم. لقد وصلتَ في الوقت المناسب تماماً.'),
      ]);
      lookAtLayla(2.0);
      await ctx.say([
        L('بابا… أنا خائفة.'),
        K('لا تنظري إليه يا حبيبتي. انظري إليّ أنا. انظري إليّ فقط.'),
        K('دعها تذهب. خذني أنا. أتوسل إليك… خذني أنا وحدي.'),
        S('كلهم يقولون هذا. كلهم يظنون أن التوسّل عملة.'),
        S('هذا هو الجزء الذي أحبّه: اللحظة التي يفهم فيها الأب…'),
        S('…أنه لا يستطيع أن يفعل شيئاً.'),
        K('لا. لا لا لا — لا تفعل! لااااا!'),
      ]);

      // الضربة
      voice.clear();
      audio.stinger('shock');
      audio.impact(true);
      ctx.shake(1.4);
      ctx.killCompanion();
      await ctx.wait(0.9);
      await ctx.say([L('…بابا.')]);
      await ctx.wait(1.6);

      // الحزن
      audio.stinger('grief');
      ctx.grief(true);
      lookAtLayla(1.4);
      await ctx.say([
        K('ليلى…'),
        K('ليلى، افتحي عينيكِ. أرجوكِ… افتحي عينيكِ يا حبيبتي.'),
        K('أنا هنا. بابا هنا. قومي… قومي أرجوكِ…'),
        K('أنا آسف. أنا آسف. أنا آسف يا ليلى…'),
      ]);

      // الضحك
      ctx.focusOn(boss.mesh, 1.6);
      ctx.laugh();
      await ctx.say([
        S('ابكِ. ابكِ أكثر.'),
        S('البكاء هو أجمل صوتٍ في هذا البيت. لا شيء يعلو عليه.'),
        S('والآن اخرج. اترك جثتها لي واخرج، فأنا لا أقتل الآباء…'),
        S('…أنا أتركهم يعيشون.'),
      ]);

      await ctx.wait(0.6);
      await ctx.say([
        K('لا.'),
        K('لن أخرج.'),
        K('سأقتلك.'),
        S('…أخيراً.'),
        S('أخيراً أصبحتَ مسلّياً يا كريم.'),
      ]);
      ctx.laugh();
      await ctx.wait(1.0);
      ctx.vanishBoss();
      await ctx.say([
        K('أينما ذهبت… سأجدك.'),
      ]);

      ctx.grief(false);
      ctx.rage();
      ctx.giveWeapon('shotgun', 24);
      ctx.lockPlayer(false);
      ctx.setObjective('اتبعه. لا شيء آخر يهم الآن.');
      ctx.openExit();
      ctx.unsealDoors();
    },
    complete: (ctx) => ctx.flags.has('reachedExit'),
  },

  // -------------------------------------------------------------------------
  revenge: {
    ambient: [
      K('اخرج! اخرج أيها الجبان!'),
      K('لن أتعب قبلك.'),
    ],
    async start(ctx) {
      ctx.setObjective('اقتل الراعي');
      await ctx.say([
        K('لا مزيد من الهرب.'),
      ]);
    },
    triggers: {
      '!': async (ctx) => {
        if (ctx.flags.has('bossStarted')) return;
        ctx.flags.add('bossStarted');
        const boss = ctx.spawnBoss();
        boss.state = 'chase';
        ctx.audio.stinger('rage');
        await ctx.say([
          S('أنت غاضب. جيد.'),
          S('الغضب يجعل اللحم أطيب.'),
          K('هذا من أجل ليلى.'),
        ]);
      },
    },
    async onBossPhase(phase, ctx) {
      if (phase === 2) {
        await ctx.say([
          S('أتظن أن الرصاص يوجع من مات مرتين؟'),
          K('سأكتشف ذلك.'),
        ]);
      } else if (phase === 3) {
        await ctx.say([
          S('كفى لعباً!'),
          K('نعم. كفى.'),
        ]);
      }
    },
    async onBossDeath(ctx) {
      ctx.audio.stinger('grief');
      await ctx.say([
        S('هذا البيت… لن يدعك تخرج…'),
        S('لن يدعك…'),
        K('لا يهم.'),
        K('لم أعد أريد الخروج.'),
      ]);
      await ctx.wait(1.2);
      await ctx.ending();
    },
    complete: (ctx) => ctx.flags.has('ending'),
  },
};

export const ENDING_LINES = [
  N('خرج كريم من البيت عند الفجر، وابنته بين ذراعيه.'),
  N('لم يخبر أحداً بما رآه. ولم يعد أحدٌ يسمع صوت ضحكٍ في ذلك الطريق.'),
  N('لكن في كل ليلة مطر… يقف على الطريق، وينتظر أن يضيع أحدهم.'),
  K('ليلى… انتهى الأمر. نامي الآن.'),
];

export const LAUGH_LINES = [
  'هههههههه.',
  'ما زلتَ حيّاً؟ كم هذا مؤسف.',
  'اركض. الركض يجعل الأمر أطول.',
  'هل تسمع؟ إنها تناديك.',
];
