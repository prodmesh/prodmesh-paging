// Draws one code onto a black frame. Shared by /key and the admin preview so
// what tech sees while adjusting is exactly what goes to the ATEM.
//
// Sizes are container-query units (cqh = 1% of the frame's height), so a
// 320-pixel preview and a 1080p output scale identically.

const TL = { top: 1, left: 1, align: 'left' };
const TR = { top: 1, right: 1, align: 'right' };
const BL = { bottom: 1, left: 1, align: 'left' };
const BR = { bottom: 1, right: 1, align: 'right' };

// The "both" positions draw the same code in two corners. One key output then
// serves screens that each mask to a different side — a left projector keeps
// the left copy, a right one the right.
const PLACES = {
  'top-right': [TR],
  'top-left': [TL],
  'top-both': [TL, TR],
  'bottom-right': [BR],
  'bottom-left': [BL],
  'bottom-both': [BL, BR],
  center: [{ center: true, align: 'center' }],
};

// `beat` is the heartbeat square's current state: true draws it, false
// leaves its corner black. The caller flips it on every server message.
export function renderKey(frame, code, display, beat = false) {
  frame.replaceChildren();
  if (!display) return;
  if (code) {
    for (const place of PLACES[display.position] ?? PLACES['top-right']) {
      frame.append(drawBox(place, code, display));
    }
  }
  const hb = display.heartbeat;
  if (hb?.enabled && beat) frame.append(drawHeartbeat(hb));
}

// Pure white, like everything else on this frame. It belongs outside the
// keyer's mask, so it shows on the multiview and never on the projectors.
function drawHeartbeat(hb) {
  const dot = document.createElement('div');
  dot.className = 'key-heartbeat';
  const size = `${hb.sizeVh}cqh`;
  const margin = `${hb.marginVh}cqh`;
  Object.assign(dot.style, { width: size, height: size });
  const [v, h] = hb.position.split('-');
  dot.style[v] = margin;
  dot.style[h] = margin;
  return dot;
}

function drawBox(place, code, display) {
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
  return box;
}
