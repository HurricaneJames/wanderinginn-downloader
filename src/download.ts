import * as fs from 'fs';
import fetch from 'node-fetch';
import { load as cheerioLoad } from 'cheerio';

const WANDERING_INN_URL = 'https://wanderinginn.com/';
const INDEX_CACHE = 'index.cached.html';
const DELAY_MS = 1250;

type Chapter = {
  id: number,
  title: string,
  url: string,
}

type Volume = {
  title: string,
  chapters: Chapter[],
}

async function genTableOfContents(shouldFetchLive: boolean): Promise<Volume[]> {
  const body = await genIndexPage(shouldFetchLive);
  const $ = cheerioLoad(body);

  const secondary = $('#secondary aside');
  const tableOfContents = secondary.filter(function toc() {
    return $(this).find('.widget-title').text().toLowerCase().startsWith('table of contents');
  });
  if (tableOfContents.length !== 1) throw new Error('Could not find table of contents');

  let volumes: Volume[] = [];
  tableOfContents.first().find('.textwidget').children('p').each(function toc(i) {
    const idx = Math.floor(i / 2);
    if (i % 2 === 0) {
      volumes[idx] = {
        title: $(this).text().trim(),
        chapters: [],
      };
    } else {
      const url = $()
      volumes[idx].chapters = $(this).children('a').toArray().map((chapter, chapterIndex) => ({
        id: chapterIndex,
        title: $(chapter).text().trim(),
        url: fixUrl($(chapter).attr('href') || ''),
      }));
    }
  });
  return volumes;
}

function fixUrl(url: string): string {
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  return url;
}

async function genIndexPage(shouldFetchLive: boolean): Promise<string> {
  if (shouldFetchLive || !fs.existsSync(INDEX_CACHE)) {
    const response = await fetch(WANDERING_INN_URL);
    const html = await response.text();
    fs.writeFileSync(INDEX_CACHE, html, 'utf-8');
    return html;
  }
  return fs.readFileSync(INDEX_CACHE).toString();
}

async function genChapter(volume: Volume, chapter: Chapter, shouldUseCacheIfAvailable: boolean) {
  const directory = `./chapters/${volume.title}`;
  const filename = `${directory}/${chapter.title}.html`;
  fs.mkdirSync(directory, { recursive: true });
  if (shouldUseCacheIfAvailable && fs.existsSync(filename)) {
    return fs.readFileSync(filename).toString();
  }
  await randomDelay(DELAY_MS, async () => console.log('fetching: ', filename, chapter.url));
  const response = await fetch(chapter.url);
  const body = await response.text();
  const $ = cheerioLoad(body);
  const article = $('#content article').clone().addClass('chapter').wrap('<p/>').parent().html();
  if (article == null) {
    console.log('Could not fetch');
  }
  if (article != null) {
    fs.writeFile(filename, article, 'utf-8', (err) => {
      if (err) throw err;
      console.log('Saved content for Chapter: ', chapter.title);
    });
  }

  return article || '';
}

async function genPrefetchChapters(volumes: Volume[], refetchAll: boolean = false) {
  const jobs = volumes.flatMap(volume =>
    volume.chapters.map(chapter => async () => await genChapter(volume, chapter, !refetchAll))
  );
  for (let job of jobs) {
    await job();
  }
}


function delay<T>(ms: number, action: () => Promise<T>) {
  return new Promise(resolve => setTimeout(
    async () => {
      const result = await action();
      resolve(result);
    }, ms
  ));
}
function randomDelay<T>(ms: number, action: () => Promise<T>) {
  return delay(Math.floor(ms * Math.random()), action);
}

async function genVolumeHTML(volume: Volume): Promise<string> {
  const chapters = await Promise.all(volume.chapters.map(async chapter => await genChapter(volume, chapter, true)));
  return `<html>\n<title>The Wandering Inn - ${volume.title}</title>\n<body>\n${chapters.join('\n')}\n</body>\n</html>`;
}

async function main() {
  fs.mkdirSync('./volumes', { recursive: true });
  const volumes = await genTableOfContents(false);
  await genPrefetchChapters(volumes);
  for (let volume of volumes) {
    const volumeHTML = await genVolumeHTML(volume);
    console.log('Saving: ', volume.title);
    fs.writeFileSync(`./volumes/${volume.title}.html`, volumeHTML, 'utf-8');
  }
}
main();