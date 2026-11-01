// Procedural layer art for the Space Pirates flagship project. Every trait is a
// full-canvas 1024×1024 SVG with a transparent background (except Background),
// sharing the same anchor points so any combination lines up.

const W = 1024;
const svg = (body: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><defs>${defs}</defs>${body}</svg>`;
const out = (w = 7) => `stroke="#0b0b14" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function stars(seed: number, n: number, color = "#fff") {
  const r = lcg(seed);
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = (r() * W).toFixed(0);
    const y = (r() * W).toFixed(0);
    const s = (0.8 + r() * 2.6).toFixed(1);
    out += `<circle cx="${x}" cy="${y}" r="${s}" fill="${color}" opacity="${(0.35 + r() * 0.65).toFixed(2)}"/>`;
  }
  return out;
}
const rect = (fill: string) => `<rect width="${W}" height="${W}" fill="${fill}"/>`;

// ---------------------------------------------------------------- backgrounds
export const backgrounds: Record<string, string> = {
  "Deep Space": svg(
    rect("url(#g)") + stars(1, 220),
    `<radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#1b2550"/><stop offset="1" stop-color="#05070f"/></radialGradient>`,
  ),
  "Nebula Violet": svg(
    rect("#0d0820") +
      `<g filter="url(#b)"><ellipse cx="300" cy="300" rx="380" ry="220" fill="#7c3aed" opacity=".55"/><ellipse cx="760" cy="640" rx="360" ry="260" fill="#db2777" opacity=".4"/><ellipse cx="620" cy="220" rx="220" ry="160" fill="#22d3ee" opacity=".25"/></g>` +
      stars(2, 160),
    `<filter id="b"><feGaussianBlur stdDeviation="70"/></filter>`,
  ),
  "Sherwood Station": svg(
    rect("url(#g)") +
      stars(3, 90, "#d1fae5") +
      `<g opacity=".55" fill="none" stroke="#86efac" stroke-width="10"><ellipse cx="800" cy="230" rx="170" ry="60"/><ellipse cx="800" cy="230" rx="110" ry="38"/></g><circle cx="800" cy="230" r="34" fill="#bbf7d0" opacity=".7"/>`,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#052e1a"/><stop offset="1" stop-color="#14532d"/></linearGradient>`,
  ),
  "Red Giant": svg(
    rect("url(#g)") + `<circle cx="760" cy="300" r="260" fill="url(#s)"/>` + stars(4, 70, "#fed7aa"),
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b0a0a"/><stop offset="1" stop-color="#7c2d12"/></linearGradient><radialGradient id="s"><stop offset="0" stop-color="#fdba74"/><stop offset=".7" stop-color="#ef4444"/><stop offset="1" stop-color="#ef4444" stop-opacity="0"/></radialGradient>`,
  ),
  "Asteroid Belt": svg(
    rect("#111827") +
      stars(5, 120) +
      [
        [120, 180, 70],
        [880, 140, 50],
        [900, 760, 90],
        [160, 860, 60],
        [700, 90, 30],
        [60, 520, 40],
      ]
        .map(
          ([x, y, r]) =>
            `<g transform="translate(${x} ${y})"><path d="M${-r},0 L${-r * 0.4},${-r * 0.9} L${r * 0.6},${-r * 0.8} L${r},${r * 0.1} L${r * 0.3},${r * 0.9} L${-r * 0.7},${r * 0.7}Z" fill="#4b5563" ${out()}/><circle cx="${r * 0.2}" cy="${-r * 0.2}" r="${r * 0.2}" fill="#374151"/></g>`,
        )
        .join(""),
  ),
  "Event Horizon": svg(
    rect("#020204") +
      stars(6, 140) +
      `<ellipse cx="512" cy="330" rx="430" ry="90" fill="none" stroke="url(#d)" stroke-width="40" opacity=".9"/><circle cx="512" cy="330" r="150" fill="#000"/><circle cx="512" cy="330" r="158" fill="none" stroke="#fbbf24" stroke-width="6" opacity=".8"/>`,
    `<linearGradient id="d"><stop offset="0" stop-color="#f97316" stop-opacity="0"/><stop offset=".5" stop-color="#fde68a"/><stop offset="1" stop-color="#f97316" stop-opacity="0"/></linearGradient>`,
  ),
  "Royal Armada Gold": svg(
    rect("url(#g)") + stars(7, 160, "#fff7d6") + `<path d="M0 760 Q512 640 1024 760 L1024 1024 L0 1024Z" fill="#b45309" opacity=".35"/>`,
    `<radialGradient id="g" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="#fde68a"/><stop offset=".55" stop-color="#d97706"/><stop offset="1" stop-color="#451a03"/></radialGradient>`,
  ),
};

// ---------------------------------------------------------------------- bodies
const TORSO = "M170,1024 C180,860 300,782 512,772 C724,782 844,860 854,1024 Z";
const organicHead = (skin: string, shade: string, extra = "") =>
  svg(
    `<path d="${TORSO}" fill="${skin}" ${out()}/>` +
      `<rect x="458" y="600" width="108" height="190" rx="30" fill="${shade}" ${out()}/>` +
      `<ellipse cx="345" cy="485" rx="26" ry="44" fill="${skin}" ${out()}/><ellipse cx="679" cy="485" rx="26" ry="44" fill="${skin}" ${out()}/>` +
      `<ellipse cx="512" cy="470" rx="168" ry="192" fill="${skin}" ${out()}/>` +
      `<ellipse cx="455" cy="540" rx="40" ry="20" fill="${shade}" opacity=".35"/><ellipse cx="575" cy="540" rx="40" ry="20" fill="${shade}" opacity=".35"/>` +
      extra,
  );
const robotHead = (metal: string, shade: string) =>
  svg(
    `<path d="${TORSO}" fill="${shade}" ${out()}/>` +
      `<rect x="470" y="610" width="84" height="180" fill="${shade}" ${out()}/><g stroke="#0b0b14" stroke-width="5"><line x1="470" y1="660" x2="554" y2="660"/><line x1="470" y1="710" x2="554" y2="710"/></g>` +
      `<rect x="318" y="440" width="44" height="90" rx="12" fill="${shade}" ${out()}/><rect x="662" y="440" width="44" height="90" rx="12" fill="${shade}" ${out()}/>` +
      `<rect x="352" y="292" width="320" height="350" rx="64" fill="${metal}" ${out()}/>` +
      `<rect x="380" y="318" width="80" height="20" rx="10" fill="#fff" opacity=".35"/>` +
      `<line x1="512" y1="292" x2="512" y2="230" ${out()}/><circle cx="512" cy="222" r="18" fill="#ef4444" ${out()}/>` +
      `<g fill="${shade}">${[372, 652].map((x) => `<circle cx="${x}" cy="${612}" r="7"/>`).join("")}</g>`,
  );

export const bodies: Record<string, string> = {
  "Human Fair": organicHead("#f5d0b5", "#d9a585"),
  "Human Tan": organicHead("#d9a06b", "#b97e4c"),
  "Human Umber": organicHead("#8d5a3b", "#6b412a"),
  "Alien Verdant": organicHead(
    "#6ee7a8",
    "#2f9e6a",
    `<path d="M440,300 Q400,200 370,170" fill="none" ${out()}/><circle cx="366" cy="164" r="20" fill="#facc15" ${out()}/><path d="M584,300 Q624,200 654,170" fill="none" ${out()}/><circle cx="658" cy="164" r="20" fill="#facc15" ${out()}/>`,
  ),
  "Alien Violet": organicHead(
    "#a78bfa",
    "#6d28d9",
    `<path d="M330,470 L250,380 L350,430Z" fill="#a78bfa" ${out()}/><path d="M694,470 L774,380 L674,430Z" fill="#a78bfa" ${out()}/><circle cx="512" cy="360" r="14" fill="#f0abfc" ${out()}/>`,
  ),
  Cyborg: organicHead(
    "#e0b48f",
    "#b98863",
    `<path d="M512,280 C600,282 680,360 680,470 C680,560 640,620 590,650 L560,560 L512,520 Z" fill="#9ca3af" ${out()}/><g fill="#4b5563"><circle cx="560" cy="330" r="8"/><circle cx="640" cy="420" r="8"/><circle cx="620" cy="560" r="8"/></g><path d="M512,280 L512,520" stroke="#22d3ee" stroke-width="5"/>`,
  ),
  "Robot Chrome": robotHead("#cbd5e1", "#64748b"),
  "Robot Brass": robotHead("#d4a24c", "#8a5a1c"),
};

// --------------------------------------------------------------------- outfits
const torso = (fill: string, extra: string) => svg(`<path d="${TORSO}" fill="${fill}" ${out()}/>${extra}`);
export const outfits: Record<string, string> = {
  "Outlaw Coat": torso(
    "#166534",
    `<path d="M420,790 L512,930 L604,790" fill="#14532d" ${out()}/><path d="M512,930 L512,1024" ${out()}/><path d="M300,880 L760,1024" stroke="#78350f" stroke-width="34"/><path d="M300,880 L760,1024" ${out()} fill="none" opacity=".4"/>`,
  ),
  "Ranger Uniform": torso(
    "#0f766e",
    `<path d="M220,880 Q260,820 360,800 L380,880Z" fill="#115e59" ${out()}/><path d="M804,880 Q764,820 664,800 L644,880Z" fill="#115e59" ${out()}/><path d="M640,900 l14,30 32,4 -24,22 7,32 -29,-16 -29,16 7,-32 -24,-22 32,-4z" fill="#fde047" ${out()}/><rect x="480" y="780" width="64" height="40" rx="10" fill="#134e4a" ${out()}/>`,
  ),
  "Leather Vest": torso(
    "#f1f5f9",
    `<path d="M300,830 Q330,790 440,780 L470,1024 L250,1024Z" fill="#92400e" ${out()}/><path d="M724,830 Q694,790 584,780 L554,1024 L774,1024Z" fill="#92400e" ${out()}/><g fill="#fbbf24">${[880, 940].map((y) => `<circle cx="540" cy="${y}" r="9"/>`).join("")}</g>`,
  ),
  "Space Suit": torso(
    "#e5e7eb",
    `<rect x="402" y="860" width="220" height="130" rx="22" fill="#9ca3af" ${out()}/><g>${["#22d3ee", "#f43f5e", "#facc15"].map((c, i) => `<circle cx="${452 + i * 60}" cy="905" r="15" fill="${c}"/>`).join("")}</g><path d="M400,790 Q512,840 624,790" fill="none" stroke="#6b7280" stroke-width="22"/>`,
  ),
  "Captain's Greatcoat": torso(
    "#1e3a8a",
    `<path d="M430,785 L512,900 L594,785" fill="#f8fafc" ${out()}/><path d="M512,900 L512,1024" ${out()}/><g fill="#fbbf24" ${out()}>${[940, 990].map((y) => `<circle cx="470" cy="${y}" r="11"/><circle cx="554" cy="${y}" r="11"/>`).join("")}</g><path d="M215,880 Q250,815 350,800 L360,850 Z" fill="#fbbf24" ${out()}/><path d="M809,880 Q774,815 674,800 L664,850 Z" fill="#fbbf24" ${out()}/>`,
  ),
  "Royal Exile Robes": torso(
    "#581c87",
    `<path d="M512,772 L512,1024" stroke="#facc15" stroke-width="26"/><path d="M380,790 Q512,880 644,790" fill="none" stroke="#facc15" stroke-width="22"/><circle cx="512" cy="862" r="26" fill="#e11d48" ${out()}/>`,
  ),
};

// ------------------------------------------------------------------------ eyes
const LX = 447;
const RX = 577;
const EY = 468;
const eyeWhite = (x: number, pupil = "#111827") =>
  `<ellipse cx="${x}" cy="${EY}" rx="34" ry="28" fill="#fff" ${out()}/><circle cx="${x + 4}" cy="${EY + 2}" r="14" fill="${pupil}"/><circle cx="${x + 9}" cy="${EY - 4}" r="5" fill="#fff"/>`;
export const eyes: Record<string, string> = {
  Determined: svg(
    eyeWhite(LX) + eyeWhite(RX) + `<path d="M405,420 L485,432" ${out(14)}/><path d="M619,420 L539,432" ${out(14)}/>`,
  ),
  Squint: svg(`<path d="M415,470 Q447,452 479,470" fill="none" ${out(10)}/><path d="M545,470 Q577,452 609,470" fill="none" ${out(10)}/>`),
  Eyepatch: svg(
    eyeWhite(LX) +
      `<path d="M340,400 L700,520" ${out(10)}/><ellipse cx="${RX}" cy="${EY}" rx="46" ry="40" fill="#111827" ${out()}/><path d="M405,420 L485,432" ${out(14)}/>`,
  ),
  Glowing: svg(
    `<g filter="url(#gl)"><ellipse cx="${LX}" cy="${EY}" rx="34" ry="24" fill="#22d3ee"/><ellipse cx="${RX}" cy="${EY}" rx="34" ry="24" fill="#22d3ee"/></g><ellipse cx="${LX}" cy="${EY}" rx="26" ry="16" fill="#ecfeff"/><ellipse cx="${RX}" cy="${EY}" rx="26" ry="16" fill="#ecfeff"/>`,
    `<filter id="gl" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="12"/></filter>`,
  ),
  "Star-Struck": svg(
    [LX, RX]
      .map(
        (x) =>
          `<path transform="translate(${x} ${EY})" d="M0,-36 L10,-11 37,-11 15,6 23,32 0,16 -23,32 -15,6 -37,-11 -10,-11Z" fill="#facc15" ${out(5)}/>`,
      )
      .join(""),
  ),
  "LED Eyes": svg(
    `<g filter="url(#gl)"><rect x="405" y="450" width="84" height="34" rx="8" fill="#ef4444"/><rect x="535" y="450" width="84" height="34" rx="8" fill="#ef4444"/></g><rect x="405" y="450" width="84" height="34" rx="8" fill="#fca5a5" ${out(5)}/><rect x="535" y="450" width="84" height="34" rx="8" fill="#fca5a5" ${out(5)}/>`,
    `<filter id="gl" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="10"/></filter>`,
  ),
};

// ---------------------------------------------------------------------- mouths
const MY = 572;
export const mouths: Record<string, string> = {
  Grin: svg(`<path d="M455,${MY} Q512,${MY + 52} 569,${MY}Z" fill="#7f1d1d" ${out()}/><path d="M468,${MY + 4} L556,${MY + 4}" stroke="#fff" stroke-width="10"/>`),
  Smirk: svg(`<path d="M470,${MY + 10} Q530,${MY + 26} 572,${MY - 8}" fill="none" ${out(10)}/>`),
  Neutral: svg(`<path d="M478,${MY + 8} L548,${MY + 8}" ${out(10)}/>`),
  "Gold Tooth": svg(
    `<path d="M455,${MY} Q512,${MY + 52} 569,${MY}Z" fill="#7f1d1d" ${out()}/><rect x="520" y="${MY}" width="22" height="20" fill="#facc15" ${out(4)}/>`,
  ),
  Rebreather: svg(
    `<rect x="430" y="${MY - 40}" width="164" height="96" rx="40" fill="#374151" ${out()}/><g fill="#9ca3af">${[0, 1, 2].map((i) => `<rect x="${462 + i * 40}" y="${MY - 16}" width="20" height="50" rx="8"/>`).join("")}</g><path d="M430,${MY} L350,${MY - 70}" ${out()}/><path d="M594,${MY} L674,${MY - 70}" ${out()}/>`,
  ),
  "Speaker Grille": svg(
    `<rect x="440" y="${MY - 22}" width="144" height="64" rx="14" fill="#1f2937" ${out()}/><g stroke="#22d3ee" stroke-width="6">${[0, 1, 2, 3, 4].map((i) => `<line x1="${462 + i * 25}" y1="${MY - 8}" x2="${462 + i * 25}" y2="${MY + 28}"/>`).join("")}</g>`,
  ),
};

// -------------------------------------------------------------------- headgear
export const headgear: Record<string, string> = {
  "Pirate Hood": svg(
    `<path fill-rule="evenodd" d="M512,200 C680,200 740,360 730,520 C725,640 690,720 650,780 L374,780 C334,720 299,640 294,520 C284,360 344,200 512,200 Z M512,330 C420,330 370,400 372,500 C374,600 430,680 512,690 C594,680 650,600 652,500 C654,400 604,330 512,330 Z" fill="#14532d" ${out()}/><path d="M512,200 C560,150 610,140 640,150" fill="none" ${out()}/>`,
  ),
  "Feathered Cap": svg(
    `<path d="M300,370 Q512,180 760,330 Q640,300 520,330 Q400,350 300,370Z" fill="#15803d" ${out()}/><path d="M330,372 Q512,330 730,340" fill="none" stroke="#854d0e" stroke-width="18"/><path d="M640,320 Q760,150 860,120 Q790,230 670,330Z" fill="#dc2626" ${out()}/><path d="M660,320 Q760,200 840,140" fill="none" stroke="#7f1d1d" stroke-width="5"/>`,
  ),
  "Space Helmet": svg(
    `<circle cx="512" cy="468" r="262" fill="#bae6fd" fill-opacity=".18" stroke="#e0f2fe" stroke-width="14"/><path d="M360,300 Q420,250 500,240" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".8"/><rect x="330" y="700" width="364" height="60" rx="26" fill="#9ca3af" ${out()}/>`,
  ),
  "Cybernetic Visor": svg(
    `<rect x="350" y="428" width="324" height="84" rx="30" fill="#0f172a" ${out()}/><rect x="372" y="446" width="280" height="48" rx="20" fill="url(#v)"/><rect x="390" y="452" width="90" height="10" rx="5" fill="#fff" opacity=".6"/>`,
    `<linearGradient id="v"><stop offset="0" stop-color="#f43f5e"/><stop offset="1" stop-color="#a855f7"/></linearGradient>`,
  ),
  Bandana: svg(
    `<path d="M338,400 Q340,270 512,262 Q684,270 686,400 Q512,350 338,400Z" fill="#dc2626" ${out()}/><g fill="#fff">${[420, 500, 590].map((x) => `<circle cx="${x}" cy="330" r="9"/>`).join("")}</g><path d="M680,380 L760,430 L720,470Z" fill="#dc2626" ${out()}/>`,
  ),
  "Royal Crown": svg(
    `<path d="M380,330 L380,200 L440,270 L512,170 L584,270 L644,200 L644,330Z" fill="#facc15" ${out()}/><rect x="372" y="318" width="280" height="40" rx="10" fill="#eab308" ${out()}/><g>${[["#e11d48", 512], ["#22d3ee", 430], ["#22d3ee", 594]].map(([c, x]) => `<circle cx="${x}" cy="338" r="11" fill="${c}"/>`).join("")}</g>`,
  ),
  "Halo of Sherwood": svg(
    `<g filter="url(#h)"><ellipse cx="512" cy="230" rx="190" ry="44" fill="none" stroke="#fde68a" stroke-width="30"/></g><ellipse cx="512" cy="230" rx="190" ry="44" fill="none" stroke="#fffbeb" stroke-width="12"/>` +
      [330, 420, 512, 604, 694]
        .map((x, i) => `<path transform="translate(${x} ${i % 2 ? 196 : 262}) rotate(${i * 35})" d="M0,-26 Q22,0 0,26 Q-22,0 0,-26Z" fill="#4ade80" ${out(4)}/>`)
        .join(""),
    `<filter id="h" x="-.5" y="-2" width="2" height="5"><feGaussianBlur stdDeviation="16"/></filter>`,
  ),
};

// --------------------------------------------------------------------- weapons
export const weapons: Record<string, string> = {
  "Plasma Bow": svg(
    `<g filter="url(#p)"><path d="M120,420 Q60,700 210,980" fill="none" stroke="#22d3ee" stroke-width="22"/></g><path d="M120,420 Q60,700 210,980" fill="none" stroke="#ecfeff" stroke-width="12" stroke-linecap="round"/><path d="M120,420 L210,980" stroke="#a5f3fc" stroke-width="3"/>`,
    `<filter id="p" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="10"/></filter>`,
  ),
  "Laser Cutlass": svg(
    `<g transform="rotate(-24 860 760)"><g filter="url(#p)"><rect x="845" y="340" width="34" height="400" rx="17" fill="#f43f5e"/></g><rect x="852" y="340" width="20" height="400" rx="10" fill="#ffe4e6"/><rect x="820" y="738" width="84" height="22" rx="8" fill="#facc15" ${out()}/><rect x="846" y="760" width="32" height="110" rx="10" fill="#78350f" ${out()}/></g>`,
    `<filter id="p" x="-2" y="-1" width="5" height="3"><feGaussianBlur stdDeviation="12"/></filter>`,
  ),
  "Ion Pistol": svg(
    `<g transform="translate(760 760) rotate(-15)"><rect x="0" y="0" width="190" height="60" rx="18" fill="#475569" ${out()}/><rect x="150" y="16" width="70" height="28" rx="10" fill="#22d3ee" ${out()}/><rect x="20" y="50" width="54" height="120" rx="14" fill="#1e293b" ${out()}/></g>`,
  ),
  "Star Staff": svg(
    `<rect x="880" y="300" width="24" height="724" rx="12" fill="#7c2d12" ${out()}/><path transform="translate(892 270)" d="M0,-70 L20,-22 72,-22 30,10 46,62 0,32 -46,62 -30,10 -72,-22 -20,-22Z" fill="#fde047" ${out()}/>`,
  ),
  "Quiver of Comets": svg(
    `<g transform="rotate(18 150 760)"><rect x="100" y="620" width="110" height="360" rx="30" fill="#92400e" ${out()}/>${[0, 1, 2].map((i) => `<path d="M${125 + i * 30},620 L${125 + i * 30},520" ${out()}/><circle cx="${125 + i * 30}" cy="510" r="16" fill="#38bdf8" ${out(4)}/>`).join("")}</g>`,
  ),
};

// ------------------------------------------------------------------ companions
export const companions: Record<string, string> = {
  "Space Parrot": svg(
    `<g transform="translate(250 760)"><ellipse cx="0" cy="0" rx="62" ry="82" fill="#ef4444" ${out()}/><path d="M-40,20 Q-90,90 -40,150 L0,60Z" fill="#2563eb" ${out()}/><circle cx="18" cy="-40" r="14" fill="#fff" ${out(4)}/><circle cx="21" cy="-40" r="6" fill="#111"/><path d="M48,-36 Q86,-20 52,4Z" fill="#facc15" ${out(5)}/></g>`,
  ),
  "Scout Drone": svg(
    `<g transform="translate(220 330)"><ellipse cx="0" cy="0" rx="70" ry="40" fill="#94a3b8" ${out()}/><circle cx="0" cy="4" r="18" fill="#22d3ee" ${out(5)}/><path d="M-70,-10 L-120,-40 M70,-10 L120,-40" ${out()}/><ellipse cx="-125" cy="-44" rx="40" ry="8" fill="#cbd5e1" ${out(4)}/><ellipse cx="125" cy="-44" rx="40" ry="8" fill="#cbd5e1" ${out(4)}/></g>`,
  ),
  "Fox-bot": svg(
    `<g transform="translate(230 850)"><path d="M-70,-40 L-60,-120 L-20,-70 L20,-70 L60,-120 L70,-40 Q70,40 0,60 Q-70,40 -70,-40Z" fill="#f97316" ${out()}/><path d="M-30,20 Q0,50 30,20 L0,60Z" fill="#fff"/><rect x="-46" y="-30" width="30" height="14" rx="5" fill="#22d3ee"/><rect x="16" y="-30" width="30" height="14" rx="5" fill="#22d3ee"/></g>`,
  ),
  "Baby Comet": svg(
    `<g transform="translate(200 300)"><path d="M0,0 L-160,-120 L-30,-30 L-170,-20 L-20,20Z" fill="#7dd3fc" opacity=".7"/><g filter="url(#c)"><circle r="60" fill="#38bdf8"/></g><circle r="48" fill="#e0f2fe" ${out()}/><circle cx="-14" cy="-6" r="7" fill="#111"/><circle cx="16" cy="-6" r="7" fill="#111"/><path d="M-10,16 Q2,26 14,16" fill="none" ${out(4)}/></g>`,
    `<filter id="c" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="14"/></filter>`,
  ),
};
