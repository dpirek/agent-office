// Each terminal cell holds two pixels: foreground above, background below.
// Hex palette keeps the scene independent of terminal themes.
const COLORS = {
  wall: '#191e22', trim: '#394145', floor: '#242724', grout: '#343831',
  dark: '#101516', glass: '#142932', city: '#45606a', light: '#edcf83',
  wood: '#be8b4d', edge: '#765334', chair: '#485560', hair: '#805339',
  skin: '#e6b78b', shirt: '#689b9a', green: '#68c69c', busy: '#ecb657',
  offline: '#596360', leaf: '#54916c', pot: '#bb8655', white: '#d6d7c4',
};
const ACTIVE = new Set(['pending', 'assigned', 'running', 'working', 'submitting']);

export function officePixels(snapshot, width, height) {
  const pixels = Array.from({ length: height }, () => Array(width).fill(COLORS.wall));
  const rect = (x, y, w, h, color) => {
    for (let j = Math.max(0, y); j < Math.min(height, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(width, x + w); i++) pixels[j][i] = COLORS[color];
    }
  };
  const floor = 10;
  rect(0, floor, width, height - floor, 'floor');
  for (let y = floor; y < height; y += 7) {
    rect(0, y, width, 1, 'grout');
    for (let x = (y % 2) * 9; x < width; x += 18) rect(x, y, 1, 7, 'grout');
  }
  rect(0, 0, width, 1, 'trim');
  rect(0, 1, 1, height - 1, 'trim');
  rect(width - 1, 1, 1, height - 1, 'trim');
  rect(1, floor - 1, width - 2, 1, 'trim');
  // Night skyline, window mullions, and suspended warm lighting.
  const windowX = Math.floor(width / 2) - 12;
  rect(windowX, 2, 24, 7, 'trim');
  rect(windowX + 1, 3, 22, 5, 'glass');
  for (let x = 0; x < 20; x += 4) {
    rect(windowX + 2 + x, 5 + (x % 3), 2, 3, 'city');
    rect(windowX + 2 + x, 6, 1, 1, 'light');
  }
  rect(windowX + 11, 3, 1, 5, 'trim');
  rect(5, 2, 9, 1, 'light');
  rect(width - 14, 2, 9, 1, 'light');
  // Server cabinet with status LEDs.
  rect(width - 8, 4, 5, 6, 'dark');
  for (let y = 5; y < 10; y += 2) {
    rect(width - 7, y, 2, 1, 'trim');
    rect(width - 4, y, 1, 1, 'green');
  }
  rect(4, 7, 3, 3, 'pot');
  rect(5, 4, 1, 4, 'leaf');
  rect(3, 5, 5, 1, 'leaf');

  const columns = Math.max(1, Math.floor((width - 4) / 17));
  const rows = Math.max(1, Math.floor((height - floor) / 13));
  const capacity = columns * rows;
  const occupants = [{ online: true, busy: snapshot.managerBusy, manager: true },
    ...(snapshot.workers || []).map(worker => ({
      online: worker.status === 'connected',
      busy: (snapshot.tasks || []).some(task => task.agent === worker.name && ACTIVE.has(task.status)),
    }))];
  for (let index = 0; index < capacity; index++) {
    const occupant = occupants[index];
    const x = Math.floor((width - columns * 17) / 2) + (index % columns) * 17 + 1;
    const y = floor + 1 + Math.floor(index / columns) * 13;
    const status = !occupant?.online ? 'offline' : occupant.busy ? 'busy' : 'green';
    rect(x, y + 4, 14, 3, 'wood');
    rect(x, y + 7, 14, 1, 'edge');
    rect(x + 1, y + 8, 2, 3, 'edge');
    rect(x + 11, y + 8, 2, 3, 'edge');
    rect(x + 4, y, 7, 5, 'dark');
    rect(x + 5, y + 1, 5, 3, occupant ? status : 'wall');
    if (occupant?.online) rect(x + 6, y + 2, 3, 1, 'dark');
    rect(x + 5, y + 5, 5, 1, 'trim');
    rect(x + 1, y + 4, 2, 2, 'white');
    rect(x + 12, y + 3, 1, 2, 'pot');
    rect(x + 11, y + 2, 3, 1, 'leaf');
    if (occupant) {
      rect(x + 6, y + 5, 3, 3, 'skin');
      rect(x + 5, y + 4, 5, 2, occupant.manager ? 'light' : 'hair');
      rect(x + 4, y + 7, 7, 3, occupant.manager ? 'busy' : 'shirt');
    }
    rect(x + 5, y + 8, 5, 3, 'chair');
    rect(x + 7, y + 11, 1, 1, 'dark');
    rect(x + 5, y + 12, 5, 1, 'dark');
  }
  return { pixels, visible: Math.min(capacity, occupants.length), total: occupants.length };
}

const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(';');

export function renderOfficeArt(snapshot, width, height) {
  const { pixels, visible, total } = officePixels(snapshot, width, height * 2);
  const lines = [];
  for (let y = 0; y < pixels.length; y += 2) {
    let line = '', previous = '';
    for (let x = 0; x < width; x++) {
      const color = `\x1b[38;2;${rgb(pixels[y][x])};48;2;${rgb(pixels[y + 1][x])}m`;
      if (color !== previous) line += color;
      line += '▀';
      previous = color;
    }
    lines.push({ art: line + '\x1b[0m' });
  }
  return { lines, visible, total };
}
