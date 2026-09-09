import React from "react";

/**
 * The Shiro mark: 白 in a ring, inline so a skin can colour it.
 *
 * `shiro` is the name and 白 is the word: white.
 *
 * ## Why the character is a path and not text
 *
 * A `<text>` element holding 白 renders as tofu on any machine with no CJK
 * font, which on Linux is the ordinary case. The outline is committed instead,
 * so the mark draws the same everywhere and needs no font at all.
 *
 * Outline: U+767D from Noto Serif JP 700, https://fonts.gstatic.com/s/notoserifjp/v33/xn71YHs72GKoTvER4Gn3b5eMRtWGkp6o7MjQ2byYPebA.ttf.
 * Noto is SIL OFL, which permits embedding and modifying outlines. The Mincho
 * faces that ship with Windows - MS, Yu, and the HG family - are commercially
 * licensed and could not be used for this.
 *
 * ## The two numbers that decide how it looks
 *
 * The character is scaled so the larger of its width or height sits at 0.84
 * of the ring's inner diameter, and centred on its own ink rather than on the em
 * box, which for CJK sits low. At 1.0 the horizontal bars cut through the ring
 * and break it; much below 0.78 the character floats inside it with gaps at the
 * sides, which is what the first version of this mark did.
 *
 * ## Colour
 *
 * `--logo-ring` and `--logo-ink`, both defaulting to `--text-hi` - already black
 * on the light skins and white on the dark ones. The mark has two parts, so the
 * old `--logo-accent` no longer applies and a skin setting it is ignored.
 */
export default function LogoMark({ size = 100, style }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none"
      role="img" aria-label="Shiro"
      style={{ display: "block", flex: "0 0 auto", ...style }}>
      <circle cx="50" cy="50" r="43" strokeWidth="6.5"
        stroke="var(--logo-ring, var(--text-hi))" />
      <path d="M21.946782334384856 32.19902208201893V27.704889589905363L33.60343848580442 32.19902208201893H69.34583596214512V34.16520504731861H32.831009463722395V79.5278548895899Q32.831009463722395 80.15984227129337 31.53192429022082 81.07271293375393Q30.232839116719244 81.98558359621451 28.126214511041013 82.68779179810726Q26.01958990536278 83.39 23.70230283911672 83.39H21.946782334384856ZM63.868611987381705 32.19902208201893H63.02596214511041L68.15208201892744 26.51113564668769L78.05321766561514 34.44608832807571Q77.6318927444795 34.93763406940063 76.89457413249212 35.42917981072555Q76.15725552050473 35.92072555205047 74.82305993690852 36.201608832807565V79.38741324921135Q74.82305993690852 79.808738170347 73.3835331230284 80.6513880126183Q71.94400630914826 81.49403785488958 69.83738170347003 82.23135646687697Q67.7307570977918 82.96867507886435 65.62413249211357 82.96867507886435H63.868611987381705ZM26.651577287066246 74.47195583596215H69.76716088328075V76.43813880126183H26.651577287066246ZM26.651577287066246 53.124826498422706H69.76716088328075V55.09100946372239H26.651577287066246ZM41.53839116719243 16.61 56.14432176656151 20.050820189274447Q55.72299684542587 21.525457413249207 53.475930599369086 21.525457413249207Q51.088422712933756 23.842744479495266 47.928485804416404 26.96757097791798Q44.76854889589905 30.092397476340693 41.327728706624605 32.62034700315457H39.36154574132492Q39.853091482649845 30.303059936908518 40.274416403785494 27.4591167192429Q40.69574132492114 24.61517350157728 41.0468454258675 21.73611987381703Q41.397949526813875 18.85706624605678 41.53839116719243 16.61Z"
        fill="var(--logo-ink, var(--text-hi))" />
    </svg>
  );
}
