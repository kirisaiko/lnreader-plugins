import { CheerioAPI, load as cheerioLoad } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';

class NovelFrance implements Plugin.PluginBase {
  id = 'novelfrance';
  name = 'NovelFrance';
  version = '1.0.0';
  icon = 'src/fr/novelfrance/icon.png';
  site = 'https://novelfrance.fr';

  filters = {
    sort: {
      value: 'popular',
      label: 'Trier par',
      options: [
        { label: 'Populaires', value: 'popular' },
        { label: 'Les plus récents', value: 'newest' },
        { label: 'Mieux notés', value: 'rating' },
        { label: 'Dernières mises à jour', value: 'updated' },
      ],
      type: FilterTypes.Picker,
    },
    genre: {
      value: '',
      label: 'Genre',
      options: [
        { label: 'Tous', value: '' },
        { label: 'Action', value: 'action' },
        { label: 'Aventure', value: 'aventure' },
        { label: 'Romance', value: 'romance' },
        { label: 'Système', value: 'syst-me' },
        { label: 'Magie', value: 'magie' },
        { label: 'Fantaisie', value: 'fantaisie' },
        { label: 'Horreur', value: 'horreur' },
        { label: 'Drama', value: 'drama' },
        { label: 'Comédie', value: 'com-die' },
        { label: 'Cultivation', value: 'cultivation' },
        { label: 'Isekai', value: 'isekai' },
        { label: 'Mystère', value: 'myst-re' },
        { label: 'Psychologique', value: 'psychologique' },
        { label: 'Sci-Fi', value: 'sci-fi' },
        { label: 'Tranche de vie', value: 'tranche-de-vie' },
      ],
      type: FilterTypes.Picker,
    },
  } satisfies Filters;

  // ─── Popular Novels ───────────────────────────────────────────────────────

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const sort = showLatestNovels
      ? 'updated'
      : (filters?.sort?.value ?? 'popular');
    const genre = filters?.genre?.value ?? '';

    let url = `${this.site}/browse?sort=${sort}&page=${pageNo}`;
    if (genre) url += `&genre=${genre}`;

    const result = await fetchApi(url);
    const body = await result.text();
    const $ = cheerioLoad(body);

    const novels: Plugin.NovelItem[] = [];

    // Cards on the browse page
    $('a[href^="/novel/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      // Skip chapter links
      if (href.split('/').length > 3) return;

      const name =
        $(el).find('h3, h4, .novel-title, [class*="title"]').first().text().trim() ||
        $(el).attr('title')?.trim() ||
        '';

      const cover =
        $(el).find('img').attr('src') ||
        $(el).find('img').attr('data-src') ||
        '';

      if (name && href) {
        novels.push({
          name,
          path: href,
          cover: cover.startsWith('http') ? cover : `${this.site}${cover}`,
        });
      }
    });

    // Deduplicate by path
    const seen = new Set<string>();
    return novels.filter(n => {
      if (seen.has(n.path)) return false;
      seen.add(n.path);
      return true;
    });
  }

  // ─── Novel Details ────────────────────────────────────────────────────────

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = `${this.site}${novelPath}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = cheerioLoad(body);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $('h1').first().text().trim(),
    };

    // Cover
    const cover =
      $('img[alt="' + novel.name + '"]').attr('src') ||
      $('img').first().attr('src') ||
      '';
    novel.cover = cover.startsWith('http') ? cover : `${this.site}${cover}`;

    // Summary – look for the description paragraph/div
    const summary =
      $('[class*="description"], [class*="synopsis"], [class*="summary"]')
        .first()
        .text()
        .trim() ||
      $('p').first().text().trim();
    if (summary) novel.summary = summary;

    // Author – "Par <author>"
    const authorText = $('*')
      .filter((_, el) => $(el).text().startsWith('Par '))
      .first()
      .text()
      .trim();
    if (authorText) novel.author = authorText.replace(/^Par\s+/i, '');

    // Status
    const statusText = $('[class*="status"], [class*="statut"]')
      .first()
      .text()
      .toLowerCase()
      .trim();
    if (statusText.includes('termin') || statusText.includes('complet')) {
      novel.status = 'Completed';
    } else if (statusText.includes('cours') || statusText.includes('ongoing')) {
      novel.status = 'Ongoing';
    }

    // Genres
    const genres: string[] = [];
    $('a[href*="/browse?genre="]').each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });
    if (genres.length) novel.genres = genres.join(', ');

    // Chapters  ─ links of the form /novel/<slug>/chapter-<N>
    const chapterLinks: Plugin.ChapterItem[] = [];
    const chapterRegex = new RegExp(`^${novelPath}/chapter-`);

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!chapterRegex.test(href)) return;

      // Try to find a chapter number / title in the element
      const rawTitle = $(el).text().trim();
      // The number shown before the title (e.g. "2884  Menace Antique")
      const numberMatch = href.match(/chapter-(\d+)/);
      const chapterNumber = numberMatch ? parseInt(numberMatch[1], 10) : 0;

      const releaseTime = $(el).find('time, [class*="date"], [class*="time"]')
        .first()
        .attr('datetime') || undefined;

      chapterLinks.push({
        name: rawTitle || `Chapitre ${chapterNumber}`,
        path: href,
        chapterNumber,
        releaseTime,
      });
    });

    // Remove duplicates and sort ascending
    const seen = new Set<string>();
    novel.chapters = chapterLinks
      .filter(c => {
        if (seen.has(c.path)) return false;
        seen.add(c.path);
        return true;
      })
      .sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));

    return novel;
  }

  // ─── Chapter Content ──────────────────────────────────────────────────────

  async parseChapter(chapterPath: string): Promise<string> {
    const url = `${this.site}${chapterPath}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = cheerioLoad(body);

    // Remove navigation / UI noise
    $(
      'nav, header, footer, script, style, [class*="navigation"], [class*="nav-"], ' +
      '[class*="chapter-nav"], [class*="btn"], button, [class*="report"], ' +
      '[class*="comment"], [class*="ads"], [class*="banner"]',
    ).remove();

    // The chapter content is typically inside a dedicated container
    const contentSelectors = [
      '[class*="chapter-content"]',
      '[class*="chapterContent"]',
      '[class*="reading-content"]',
      '[class*="novel-content"]',
      'article',
      'main .prose',
      'main',
    ];

    let content = '';
    for (const sel of contentSelectors) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 200) {
        content = el.html() || '';
        break;
      }
    }

    // Fallback: body text
    if (!content) {
      $('body').find('nav, header, footer').remove();
      content = $('body').html() || '';
    }

    return content;
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const url = `${this.site}/search?q=${encodeURIComponent(searchTerm)}&page=${pageNo}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = cheerioLoad(body);

    const novels: Plugin.NovelItem[] = [];

    $('a[href^="/novel/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.split('/').length > 3) return;

      const name =
        $(el).find('h3, h4, [class*="title"]').first().text().trim() ||
        $(el).text().trim();
      const cover =
        $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';

      if (name && href) {
        novels.push({
          name,
          path: href,
          cover: cover.startsWith('http') ? cover : `${this.site}${cover}`,
        });
      }
    });

    const seen = new Set<string>();
    return novels.filter(n => {
      if (seen.has(n.path)) return false;
      seen.add(n.path);
      return true;
    });
  }
}

export default new NovelFrance();
