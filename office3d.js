/**
 * TaskFlow — 3D Ofis (admin)
 * Vanilla Three.js ES module. Sahna: bo'lim xonalari + boshqaruv platformasi.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const MANAGEMENT_LEVELS = new Set(['direktor', 'orinbosar', 'bolim_boshligi']);

function hexToInt(hex, fallback = 0x4c8dff) {
  if (!hex) return fallback;
  const h = String(hex).trim().replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return Number.isFinite(n) ? n : fallback;
}

function positionLevelOf(u) {
  const lv = u?.position_level;
  if (lv && (MANAGEMENT_LEVELS.has(lv) || lv === 'xodim')) return lv;
  return (
    { director: 'direktor', deputy_director: 'orinbosar', dept_head: 'bolim_boshligi' }[u?.role] || 'xodim'
  );
}

function positionLabel(level) {
  return {
    direktor: 'Direktor',
    orinbosar: "Direktor o'rinbosari",
    bolim_boshligi: "Bo'lim boshlig'i",
    xodim: 'Xodim',
  }[level] || level;
}

function userWorkStatus(user, tasks) {
  const own = (tasks || []).filter(
    (t) => t.assignee_user_id === user.id || t.assignee === user.display_name
  );
  const overdue = own.filter((t) => {
    if (t.status === 'bajarildi' || t.status === 'tekshiruvda') return false;
    if (!t.deadline) return false;
    return new Date(t.deadline) < new Date();
  });
  const active = own.filter((t) => t.status === 'jarayonda' || t.status === 'tekshiruvda');
  const done = own.filter((t) => t.status === 'bajarildi');
  if (overdue.length) {
    return {
      kind: 'overdue',
      label: '⚠️ ' + (overdue[0].title || '').slice(0, 28),
      title: overdue[0].title || '',
      activeCount: active.length,
      overdueCount: overdue.length,
      doneCount: done.length,
    };
  }
  if (active.length) {
    return {
      kind: 'busy',
      label: (active[0].title || 'Jarayonda').slice(0, 28),
      title: active[0].title || '',
      activeCount: active.length,
      overdueCount: 0,
      doneCount: done.length,
    };
  }
  return {
    kind: 'free',
    label: "Bo'sh",
    title: '',
    activeCount: 0,
    overdueCount: 0,
    doneCount: done.length,
  };
}

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
    if (child.element && child.element.parentNode) child.element.parentNode.removeChild(child.element);
  });
}

function createPersonMesh(level, colors) {
  const group = new THREE.Group();
  const scale = MANAGEMENT_LEVELS.has(level) ? 1.25 : 1;
  group.scale.setScalar(scale);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: colors.accent,
    roughness: 0.55,
    metalness: 0.1,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8c4a8, roughness: 0.7 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), skinMat);
  head.position.y = 1.35;
  group.add(head);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 6, 12), bodyMat);
  body.position.y = 0.78;
  group.add(body);

  const armGeo = new THREE.CapsuleGeometry(0.07, 0.28, 4, 8);
  const leftArm = new THREE.Mesh(armGeo, bodyMat);
  leftArm.position.set(-0.32, 0.85, 0);
  leftArm.rotation.z = 0.25;
  group.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, bodyMat);
  rightArm.position.set(0.32, 0.85, 0);
  rightArm.rotation.z = -0.25;
  group.add(rightArm);

  const legGeo = new THREE.CapsuleGeometry(0.08, 0.32, 4, 8);
  const leftLeg = new THREE.Mesh(legGeo, bodyMat);
  leftLeg.position.set(-0.12, 0.28, 0);
  group.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, bodyMat);
  rightLeg.position.set(0.12, 0.28, 0);
  group.add(rightLeg);

  // Lavozim belgisi
  if (level === 'direktor') {
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.18, 5),
      new THREE.MeshStandardMaterial({ color: 0xf2b84b, metalness: 0.6, roughness: 0.3 })
    );
    crown.position.y = 1.62;
    group.add(crown);
  } else if (level === 'orinbosar') {
    const badge = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1),
      new THREE.MeshStandardMaterial({ color: 0xc0c8d4, metalness: 0.7, roughness: 0.25 })
    );
    badge.position.y = 1.6;
    group.add(badge);
  } else if (level === 'bolim_boshligi') {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.035, 8, 24),
      new THREE.MeshStandardMaterial({ color: colors.accent2, metalness: 0.4, roughness: 0.35 })
    );
    ring.position.y = 1.35;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }

  group.userData.bodyMat = bodyMat;
  group.userData.armL = leftArm;
  group.userData.armR = rightArm;
  group.userData.baseScale = scale;
  return group;
}

function makeLabelEl(user, status, level) {
  const el = document.createElement('div');
  el.className = 'office3d-label';
  el.innerHTML =
    `<div class="name">${escape(user.display_name || '?')}</div>` +
    (MANAGEMENT_LEVELS.has(level)
      ? `<div class="role">${escape(positionLabel(level))}</div>`
      : '') +
    `<div class="status status-${status.kind}">${escape(status.label)}</div>`;
  return el;
}

function escape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateLabelEl(el, user, status, level) {
  el.innerHTML =
    `<div class="name">${escape(user.display_name || '?')}</div>` +
    (MANAGEMENT_LEVELS.has(level)
      ? `<div class="role">${escape(positionLabel(level))}</div>`
      : '') +
    `<div class="status status-${status.kind}">${escape(status.label)}</div>`;
}

function applyStatusVisual(person, status, colors) {
  const mat = person.userData.bodyMat;
  if (!mat) return;
  if (status.kind === 'overdue') {
    mat.color.setHex(colors.danger);
    mat.emissive.setHex(colors.danger);
    mat.emissiveIntensity = 0.45;
  } else if (status.kind === 'busy') {
    mat.color.setHex(colors.accent);
    mat.emissive.setHex(colors.accent);
    mat.emissiveIntensity = 0.28;
  } else {
    mat.color.setHex(colors.success);
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0;
  }
  person.userData.statusKind = status.kind;
  if (person.userData.labelEl) {
    updateLabelEl(person.userData.labelEl, person.userData.user, status, person.userData.level);
  }
}

export const Office3D = {
  _state: null,

  isOpen() {
    return !!this._state;
  },

  open(container, opts = {}) {
    this.close();
    const colors = this._readColors(opts.getThemeColors);
    const root = container;
    root.innerHTML = '';
    root.classList.add('office3d-active');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(colors.bg);
    scene.fog = new THREE.Fog(colors.bg, 28, 55);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
    camera.position.set(0, 12, 18);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    root.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.inset = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    root.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 6;
    controls.maxDistance = 40;
    controls.target.set(0, 1, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.85);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(8, 16, 6);
    dir.castShadow = true;
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    const tooltip = document.createElement('div');
    tooltip.className = 'office3d-tooltip hidden';
    root.appendChild(tooltip);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const st = {
      root,
      scene,
      camera,
      renderer,
      labelRenderer,
      controls,
      colors,
      people: new Map(), // userId -> group
      clickables: [],
      layoutKey: '',
      raf: 0,
      running: true,
      hovered: null,
      tooltip,
      raycaster,
      pointer,
      clock: new THREE.Clock(),
      onSelectUser: opts.onSelectUser || (() => {}),
      getThemeColors: opts.getThemeColors,
      onResize: null,
      onVis: null,
      onClick: null,
      onMove: null,
    };
    this._state = st;

    this._buildWorld(opts.users || [], opts.tasks || []);
    this._bindEvents();
    this._resize();
    this._loop();
  },

  update(users, tasks) {
    if (!this._state) return;
    const key = this._layoutKey(users || []);
    if (key !== this._state.layoutKey) {
      this._buildWorld(users || [], tasks || []);
    } else {
      this._updatePeopleStates(users || [], tasks || []);
    }
  },

  applyTheme() {
    if (!this._state) return;
    this._state.colors = this._readColors(this._state.getThemeColors);
    this._state.scene.background.setHex(this._state.colors.bg);
    if (this._state.scene.fog) this._state.scene.fog.color.setHex(this._state.colors.bg);
    this._state.people.forEach((p) => {
      applyStatusVisual(p, p.userData.lastStatus || { kind: 'free', label: "Bo'sh" }, this._state.colors);
    });
  },

  close() {
    const st = this._state;
    if (!st) return;
    st.running = false;
    if (st.raf) cancelAnimationFrame(st.raf);
    window.removeEventListener('resize', st.onResize);
    document.removeEventListener('visibilitychange', st.onVis);
    if (st.onClick) st.renderer.domElement.removeEventListener('pointerdown', st.onClick);
    if (st.onMove) st.renderer.domElement.removeEventListener('pointermove', st.onMove);

    st.people.forEach((p) => {
      st.scene.remove(p);
      disposeObject(p);
    });
    st.people.clear();
    while (st.scene.children.length) {
      const c = st.scene.children[0];
      st.scene.remove(c);
      disposeObject(c);
    }
    st.controls.dispose();
    st.renderer.dispose();
    if (st.renderer.domElement.parentNode) st.renderer.domElement.parentNode.removeChild(st.renderer.domElement);
    if (st.labelRenderer.domElement.parentNode) {
      st.labelRenderer.domElement.parentNode.removeChild(st.labelRenderer.domElement);
    }
    st.root.innerHTML = '';
    st.root.classList.remove('office3d-active');
    this._state = null;
  },

  _readColors(getter) {
    const c = (getter && getter()) || {};
    return {
      bg: hexToInt(c.bg, 0x0b0f17),
      panel: hexToInt(c.panel, 0x121826),
      border: hexToInt(c.border, 0x232c3d),
      accent: hexToInt(c.accent, 0x4c8dff),
      accent2: hexToInt(c.accent2, 0x9b6bea),
      success: hexToInt(c.success, 0x35c77a),
      danger: hexToInt(c.danger, 0xf2635c),
      warning: hexToInt(c.warning, 0xf2b84b),
      text: hexToInt(c.text, 0xe7ecf3),
    };
  },

  _layoutKey(users) {
    return users
      .map((u) => `${u.id}|${u.department || ''}|${positionLevelOf(u)}|${u.display_name || ''}`)
      .sort()
      .join(';');
  },

  _clearPeopleAndRooms() {
    const st = this._state;
    st.people.forEach((p) => {
      st.scene.remove(p);
      disposeObject(p);
    });
    st.people.clear();
    st.clickables = [];
    const toRemove = st.scene.children.filter((c) => c.userData && c.userData.isOfficeProp);
    toRemove.forEach((c) => {
      st.scene.remove(c);
      disposeObject(c);
    });
  },

  _floor(w, d, y, color, x = 0, z = 0) {
    const st = this._state;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.08, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
    );
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.userData.isOfficeProp = true;
    st.scene.add(mesh);
    return mesh;
  },

  _wall(w, h, d, x, y, z, color) {
    const st = this._state;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, transparent: true, opacity: 0.55 })
    );
    mesh.position.set(x, y, z);
    mesh.userData.isOfficeProp = true;
    st.scene.add(mesh);
  },

  _roomLabel(text, x, z) {
    const st = this._state;
    const el = document.createElement('div');
    el.className = 'office3d-room-label';
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, 2.6, z);
    obj.userData.isOfficeProp = true;
    st.scene.add(obj);
  },

  _buildWorld(users, tasks) {
    const st = this._state;
    this._clearPeopleAndRooms();
    st.layoutKey = this._layoutKey(users);
    const colors = st.colors;

    // Asosiy pol
    this._floor(40, 40, 0, colors.panel, 0, 0);

    // Boshqaruv platformasi (old)
    this._floor(14, 5, 0.35, colors.border, 0, -8);
    this._roomLabel('Boshqaruv', 0, -8);

    const managers = users.filter((u) => {
      const lv = positionLevelOf(u);
      return lv === 'direktor' || lv === 'orinbosar';
    });
    const deptHeads = users.filter((u) => positionLevelOf(u) === 'bolim_boshligi');
    const staff = users.filter((u) => positionLevelOf(u) === 'xodim');

    // Direktor / o'rinbosar — platformada
    managers
      .sort((a, b) => positionLevelOf(a).localeCompare(positionLevelOf(b)))
      .forEach((u, i) => {
        const n = managers.length;
        const x = (i - (n - 1) / 2) * 2.2;
        this._placePerson(u, x, 0.4, -8, tasks);
      });

    // Bo'lim xonalari
    const depts = Array.from(
      new Set(
        [...staff, ...deptHeads]
          .map((u) => (u.department || '').trim() || "Boshqa")
      )
    ).sort((a, b) => a.localeCompare(b, 'uz'));

    const cols = Math.min(3, Math.max(1, depts.length));
    const roomW = 8;
    const roomD = 7;
    const gap = 1.2;
    const startX = -((cols - 1) * (roomW + gap)) / 2;
    const startZ = 2;

    depts.forEach((dept, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = startX + col * (roomW + gap);
      const cz = startZ + row * (roomD + gap);

      this._floor(roomW, roomD, 0.02, idx % 2 === 0 ? 0x1a2233 : 0x162030, cx, cz);
      // past devorlar
      this._wall(roomW, 1.2, 0.12, cx, 0.65, cz - roomD / 2, colors.border);
      this._wall(0.12, 1.2, roomD, cx - roomW / 2, 0.65, cz, colors.border);
      this._wall(0.12, 1.2, roomD, cx + roomW / 2, 0.65, cz, colors.border);
      this._roomLabel(dept, cx, cz - roomD / 2 + 0.4);

      const head = deptHeads.find((u) => ((u.department || '').trim() || "Boshqa") === dept);
      const members = staff.filter((u) => ((u.department || '').trim() || "Boshqa") === dept);

      if (head) {
        this._placePerson(head, cx, 0.05, cz - roomD / 2 + 1.4, tasks);
      }

      const maxPerRow = 4;
      members.forEach((u, i) => {
        const r = Math.floor(i / maxPerRow);
        const c = i % maxPerRow;
        const mx = cx - roomW / 2 + 1.4 + c * 1.6;
        const mz = cz - 0.2 + r * 1.5;
        this._placePerson(u, mx, 0.05, mz, tasks);
      });
    });

    // Bo'limsiz menejerlar (dept head without matching room already placed)
    // done above
  },

  _placePerson(user, x, y, z, tasks) {
    const st = this._state;
    const level = positionLevelOf(user);
    const status = userWorkStatus(user, tasks);
    const person = createPersonMesh(level, st.colors);
    person.position.set(x, y, z);
    person.userData.baseY = y;
    person.userData.userId = user.id;
    person.userData.user = user;
    person.userData.level = level;
    person.userData.lastStatus = status;
    person.castShadow = true;

    const labelEl = makeLabelEl(user, status, level);
    const label = new CSS2DObject(labelEl);
    label.position.set(0, 1.85, 0);
    person.add(label);
    person.userData.labelEl = labelEl;

    applyStatusVisual(person, status, st.colors);
    st.scene.add(person);
    st.people.set(user.id, person);
    st.clickables.push(person);
  },

  _updatePeopleStates(users, tasks) {
    const st = this._state;
    users.forEach((u) => {
      const person = st.people.get(u.id);
      if (!person) return;
      person.userData.user = u;
      const status = userWorkStatus(u, tasks);
      person.userData.lastStatus = status;
      applyStatusVisual(person, status, st.colors);
    });
  },

  _bindEvents() {
    const st = this._state;
    st.onResize = () => this._resize();
    st.onVis = () => {
      st.running = document.visibilityState !== 'hidden';
      if (st.running) this._loop();
    };
    st.onMove = (e) => this._onPointerMove(e);
    st.onClick = (e) => this._onPointerClick(e);
    window.addEventListener('resize', st.onResize);
    document.addEventListener('visibilitychange', st.onVis);
    st.renderer.domElement.addEventListener('pointermove', st.onMove);
    st.renderer.domElement.addEventListener('pointerdown', st.onClick);
  },

  _resize() {
    const st = this._state;
    if (!st) return;
    const w = st.root.clientWidth || window.innerWidth;
    const h = st.root.clientHeight || window.innerHeight;
    st.camera.aspect = w / h;
    st.camera.updateProjectionMatrix();
    st.renderer.setSize(w, h, false);
    st.labelRenderer.setSize(w, h);
  },

  _pick(event) {
    const st = this._state;
    const rect = st.renderer.domElement.getBoundingClientRect();
    st.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    st.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    st.raycaster.setFromCamera(st.pointer, st.camera);
    const hits = st.raycaster.intersectObjects(st.clickables, true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData.userId) obj = obj.parent;
    return obj || null;
  },

  _onPointerMove(event) {
    const st = this._state;
    if (!st) return;
    const person = this._pick(event);
    if (st.hovered && st.hovered !== person) {
      const s = st.hovered.userData.baseScale || 1;
      st.hovered.scale.setScalar(s);
    }
    st.hovered = person;
    if (person) {
      st.renderer.domElement.style.cursor = 'pointer';
      person.scale.setScalar((person.userData.baseScale || 1) * 1.12);
      const u = person.userData.user;
      const stt = person.userData.lastStatus || {};
      st.tooltip.classList.remove('hidden');
      st.tooltip.style.left = event.clientX - st.root.getBoundingClientRect().left + 14 + 'px';
      st.tooltip.style.top = event.clientY - st.root.getBoundingClientRect().top + 14 + 'px';
      st.tooltip.innerHTML =
        `<b>${escape(u.display_name)}</b><br>` +
        `${escape(positionLabel(person.userData.level))}` +
        (u.department ? ` · ${escape(u.department)}` : '') +
        `<br>Faol: ${stt.activeCount || 0} · Kechikkan: ${stt.overdueCount || 0} · Bajarilgan: ${stt.doneCount || 0}` +
        `<br><i>Bosib topshiriq yaratish</i>`;
    } else {
      st.renderer.domElement.style.cursor = 'default';
      st.tooltip.classList.add('hidden');
    }
  },

  _onPointerClick(event) {
    const st = this._state;
    if (!st || event.button !== 0) return;
    const person = this._pick(event);
    if (person && person.userData.userId) {
      st.onSelectUser(person.userData.userId, person.userData.user);
    }
  },

  _loop() {
    const st = this._state;
    if (!st || !st.running) return;
    st.raf = requestAnimationFrame(() => this._loop());
    const t = st.clock.getElapsedTime();
    st.people.forEach((p) => {
      const kind = p.userData.statusKind || 'free';
      if (kind === 'busy') {
        if (p.userData.armL) p.userData.armL.rotation.x = Math.sin(t * 6) * 0.35;
        if (p.userData.armR) p.userData.armR.rotation.x = Math.sin(t * 6 + 1) * 0.35;
        p.position.y = (p.userData.baseY ?? p.position.y) ;
        // store base Y once
        if (p.userData.baseY == null) p.userData.baseY = p.position.y;
        p.position.y = p.userData.baseY + Math.abs(Math.sin(t * 5)) * 0.03;
      } else if (kind === 'overdue') {
        if (p.userData.baseY == null) p.userData.baseY = p.position.y;
        p.position.y = p.userData.baseY + Math.sin(t * 8) * 0.04;
      } else {
        if (p.userData.baseY == null) p.userData.baseY = p.position.y;
        p.position.y = p.userData.baseY + Math.sin(t * 1.6) * 0.02;
        if (p.userData.armL) p.userData.armL.rotation.x = 0;
        if (p.userData.armR) p.userData.armR.rotation.x = 0;
      }
    });
    st.controls.update();
    st.renderer.render(st.scene, st.camera);
    st.labelRenderer.render(st.scene, st.camera);
  },
};

export default Office3D;
