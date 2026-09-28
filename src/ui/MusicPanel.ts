/**
 * Soundtrack player (SoundCloud embed of NASA's "NASA Explorers: Apollo" playlist) in a collapsible HUD panel.
 * The third-party iframe is created only when the panel is first opened, so nothing is loaded from SoundCloud
 * until the viewer asks for it. The open state is a per-viewer convenience kept in localStorage.
 */
import type { I18n } from '../i18n';
import { h } from './dom';

const PLAYLIST = 'https://api.soundcloud.com/playlists/soundcloud%3Aplaylists%3A806386713';
// Widget colour matched to the interface accent.
const PLAYER_URL =
  'https://w.soundcloud.com/player/?url=' +
  encodeURIComponent(PLAYLIST) +
  '&color=%235ad7ff&auto_play=true&hide_related=false&show_comments=true&show_user=true' +
  '&show_reposts=false&show_teaser=true&visual=true';
const STORAGE_KEY = 'perigee.music.open';

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Storage unavailable (private mode): not critical.
  }
}

export class MusicPanel {
  readonly element: HTMLElement;
  private readonly toggle = h('button', {
    type: 'button',
    class: 'btn music-toggle',
    'aria-expanded': 'false',
    'aria-controls': 'music-body',
  });
  private readonly title = h('h2', { class: 'panel-title' });
  private readonly body = h('div', { class: 'music-body', id: 'music-body', hidden: true });
  private readonly frameHost = h('div', { class: 'music-frame' });
  private readonly credit = h('p', { class: 'music-credit small muted' });
  private readonly note = h('p', { class: 'small muted' });
  private open = false;

  constructor(private readonly i18n: I18n) {
    this.credit.append(
      h('a', { href: 'https://soundcloud.com/nasa', target: '_blank', rel: 'noopener' }, ['NASA']),
      ' · ',
      h(
        'a',
        {
          href: 'https://soundcloud.com/nasa/sets/nasa-explorers-apollo-1',
          target: '_blank',
          rel: 'noopener',
        },
        ['NASA Explorers: Apollo Soundtrack'],
      ),
    );
    this.body.append(this.title, this.frameHost, this.credit, this.note);
    this.element = h('section', { class: 'panel music' }, [this.body, this.toggle]);
    this.toggle.addEventListener('click', () => this.setOpen(!this.open));
    i18n.onChange(() => this.render());
    this.render();
    if (readOpen()) this.setOpen(true);
  }

  toggleOpen(): void {
    this.setOpen(!this.open);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    writeOpen(open);
    if (open && !this.frameHost.firstChild) {
      const iframe = h('iframe', {
        src: PLAYER_URL,
        width: '100%',
        height: 300,
        scrolling: 'no',
        frameborder: 'no',
        allow: 'autoplay; encrypted-media',
        loading: 'lazy',
        title: this.i18n.t('music.frameTitle'),
      });
      this.frameHost.append(iframe);
    }
    this.body.hidden = !open;
    this.element.classList.toggle('is-open', open);
    document.body.classList.toggle('music-open', open);
    this.render();
  }

  private render(): void {
    const t = this.i18n.t.bind(this.i18n);
    this.title.textContent = t('music.title');
    this.note.textContent = t('music.note');
    this.toggle.textContent = this.open ? t('music.hide') : `♪ ${t('music.show')}`;
    this.toggle.setAttribute('aria-expanded', String(this.open));
  }
}
