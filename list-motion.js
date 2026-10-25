// FLIP: measure the rendered positions before replacing the list, then animate
// transforms to its new layout. Sorting and saving remain synchronous.
export function createListMotion(list, preference = matchMedia('(prefers-reduced-motion: reduce)')) {
  const running = new Set();
  const visible = rect => rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  const enabled = () => !preference.matches && typeof list.animate === 'function';

  function stop() {
    for (const finish of [...running]) finish();
  }

  function animate(node, frames, options, cleanup = () => {}) {
    const animation = node.animate(frames, { fill: 'both', ...options });
    const finish = () => {
      if (!running.delete(finish)) return;
      animation.cancel();
      cleanup();
    };
    running.add(finish);
    animation.finished.then(finish, finish);
  }

  function capture() {
    if (!enabled()) { stop(); return null; }
    // Read all positions before cancelling an in-flight animation, so rapid
    // edits continue from the positions currently visible on screen.
    const before = new Map([...list.querySelectorAll('[data-card]')].map(node => [node.dataset.card, {
      node, rect: node.getBoundingClientRect(),
      cells: node.tagName === 'TR' && getComputedStyle(node).display !== 'grid'
        ? [...node.cells].map(cell => cell.getBoundingClientRect().width) : null,
    }]));
    stop();
    return before;
  }

  function play(before) {
    if (!before || !enabled()) return;
    const after = [...list.querySelectorAll('[data-card]')].map(node => ({node, rect: node.getBoundingClientRect()}));
    const remaining = new Map(before);
    // All layout reads above are batched before animation/style writes below.
    for (const {node, rect} of after) {
      const old = before.get(node.dataset.card);
      remaining.delete(node.dataset.card);
      if (old) {
        const x = old.rect.left - rect.left, y = old.rect.top - rect.top;
        if ((!visible(old.rect) && !visible(rect)) || Math.hypot(x,y) < 1) continue;
        node.classList.add('ship-reordering');
        animate(node, [{transform: `translate(${x}px, ${y}px)`}, {transform: 'translate(0, 0)'}], {
          duration: Math.min(440, 280 + Math.hypot(x,y) * .12), easing: 'cubic-bezier(.22, 1, .36, 1)',
        }, () => node.classList.remove('ship-reordering'));
      } else if (visible(rect)) {
        animate(node, [{opacity: 0}, {opacity: 1}], {duration: 220, easing: 'ease-out'});
      }
    }

    // A ship may leave the active filter or page. Keep a non-interactive visual
    // copy just long enough to fade out instead of disappearing in one frame.
    for (const {node, rect, cells} of remaining.values()) {
      if (!visible(rect)) continue;
      const ghost = document.createElement('div');
      ghost.className = 'ship-motion-exit';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      Object.assign(ghost.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
      const copy = node.cloneNode(true);
      copy.classList.remove('ship-reordering');
      for (const item of [copy, ...copy.querySelectorAll('*')]) {
        for (const attribute of ['id', 'data-card', 'data-select', 'data-ship-status', 'autofocus']) item.removeAttribute(attribute);
      }
      if (copy.tagName === 'TR') {
        const table = document.createElement('table');
        table.className = 'ship-table';
        if (cells) {
          table.style.tableLayout = 'fixed';
          [...copy.cells].forEach((cell, index) => { cell.style.width = `${cells[index]}px`; });
        }
        const body = document.createElement('tbody');
        body.append(copy); table.append(body); ghost.append(table);
      } else {
        copy.style.height = `${rect.height}px`;
        ghost.append(copy);
      }
      document.body.append(ghost);
      animate(ghost, [{opacity: 1, transform: 'translateY(0)'}, {opacity: 0, transform: 'translateY(8px)'}],
        {duration: 180, easing: 'ease-out'}, () => ghost.remove());
    }
  }

  preference.addEventListener('change', stop);
  window.addEventListener('resize', stop, {passive: true});
  // Fixed exit copies must not remain behind if the user scrolls mid-animation.
  window.addEventListener('scroll', () => {
    if (document.querySelector('.ship-motion-exit')) stop();
  }, {passive: true});
  return {capture, play, stop};
}
