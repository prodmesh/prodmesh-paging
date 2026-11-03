// Draws one code onto a black frame. Shared by /key and the admin preview so
// what tech sees while adjusting is exactly what goes to the ATEM.
//
// Sizes are container-query units (cqh = 1% of the frame's height), so a
// 320-pixel preview and a 1080p output scale identically.

const PLACE = {
  'top-right': { top: 1, right: 1, align: 'right' },
  'top-left': { top: 1, left: 1, align: 'left' },
  'bottom-right': { bottom: 1, right: 1, align: 'right' },
  'bottom-left': { bottom: 1, left: 1, align: 'left' },
  center: { center: true, align: 'center' },
};

export function renderKey(frame, code, display) {
  frame.replaceChildren();
  if (!code || !display) return;

  const place = PLACE[display.position] ?? PLACE['top-right'];
  const box = document.createElement('div');
  box.className = 'key-box';
  box.style.textAlign = place.align;
  const margin = `${display.marginVh}cqh`;
  if (place.center) {
    Object.assign(box.style, { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
  } else {
    for (const side of ['top', 'right', 'bottom', 'left']) if (place[side]) box.style[side] = margin;
  }

  if (display.showLabel && display.label) {
    const label = document.createElement('div');
    label.className = 'key-label';
    label.style.fontSize = `${display.codeSizeVh * 0.3}cqh`;
    label.textContent = display.label;
    box.append(label);
  }

  const text = document.createElement('div');
  text.className = 'key-code';
  text.style.fontSize = `${display.codeSizeVh}cqh`;
  text.textContent = code;
  box.append(text);

  frame.append(box);
}
