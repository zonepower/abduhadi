// ---------------------------------------------------------------------------
// DOM heads-up display. Kept out of WebGL so text stays crisp and RTL-correct.
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = el('hud');
    this.healthFill = el('healthFill');
    this.healthText = el('healthText');
    this.sanityFill = el('sanityFill');
    this.staminaFill = el('staminaFill');
    this.batteryFill = el('batteryFill');
    this.weaponName = el('weaponName');
    this.weaponAmmo = el('weaponAmmo');
    this.objective = el('objectiveText');
    this.subtitle = el('subtitle');
    this.subtitleWho = el('subtitleWho');
    this.subtitleText = el('subtitleText');
    this.prompt = el('prompt');
    this.toast = el('toast');
    this.bossBar = el('bossBar');
    this.bossFill = el('bossFill');
    this.chapterCard = el('chapterCard');
    this.chapterTitle = el('chapterTitle');
    this.chapterSubtitle = el('chapterSubtitle');
    this.crosshair = el('crosshair');
    this.deathScreen = el('deathScreen');
    this.objectiveBox = el('objective');
    this.toastTimer = 0;
    this.promptTimer = 0;
  }

  setVisible(visible) {
    this.root.classList.toggle('hidden', !visible);
  }

  updateVitals(player) {
    const hp = Math.max(0, player.health) / player.maxHealth;
    this.healthFill.style.width = `${hp * 100}%`;
    this.healthText.textContent = String(Math.max(0, Math.round(player.health)));
    this.healthFill.classList.toggle('critical', hp < 0.3);
    this.sanityFill.style.width = `${player.sanity * 100}%`;
    this.staminaFill.style.width = `${player.stamina * 100}%`;
    this.batteryFill.style.width = `${(player.hasFlashlight ? player.battery : 0) * 100}%`;
    this.root.classList.toggle('lowhealth', hp < 0.3);
  }

  updateWeapon(weapons) {
    const def = weapons.def;
    this.weaponName.textContent = def.name;
    this.weaponAmmo.textContent = weapons.ammoText;
    this.crosshair.classList.toggle('hidden', def.kind === 'none');
    this.crosshair.classList.toggle('melee', def.kind === 'melee');
  }

  setObjective(text) {
    if (!text) {
      this.objectiveBox.classList.add('hidden');
      return;
    }
    this.objectiveBox.classList.remove('hidden');
    this.objective.textContent = text;
    this.objectiveBox.classList.remove('flash');
    // restart the highlight animation
    void this.objectiveBox.offsetWidth;
    this.objectiveBox.classList.add('flash');
  }

  showSubtitle(payload) {
    if (!payload) {
      this.subtitle.classList.add('hidden');
      return;
    }
    this.subtitle.classList.remove('hidden');
    this.subtitleWho.textContent = payload.character.name ? `${payload.character.name}:` : '';
    this.subtitleWho.style.color = payload.character.color;
    this.subtitleText.textContent = payload.text;
  }

  showPrompt(text) {
    if (!text) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.classList.remove('hidden');
    this.prompt.innerHTML = text;
  }

  showToast(text, seconds = 2.6) {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    this.toastTimer = seconds;
  }

  showBoss(name, ratio) {
    if (ratio === null) {
      this.bossBar.classList.add('hidden');
      return;
    }
    this.bossBar.classList.remove('hidden');
    el('bossName').textContent = name;
    this.bossFill.style.width = `${Math.max(0, ratio) * 100}%`;
  }

  async showChapterCard(title, subtitle, seconds = 3.4) {
    this.chapterTitle.textContent = title;
    this.chapterSubtitle.textContent = subtitle;
    this.chapterCard.classList.remove('hidden');
    this.chapterCard.classList.add('show');
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    this.chapterCard.classList.remove('show');
    await new Promise((resolve) => setTimeout(resolve, 900));
    this.chapterCard.classList.add('hidden');
  }

  showDeath(visible, text = '') {
    this.deathScreen.classList.toggle('hidden', !visible);
    if (visible) el('deathText').textContent = text;
  }

  update(dt) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.add('hidden');
    }
  }
}
