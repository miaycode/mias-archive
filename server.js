const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "database.json");
const UPLOAD_DIR = path.join(ROOT, "img", "uploads");
const PORT = 5000;

const BLOG_CATEGORIES = ["Diary", "Philosophy", "Running", "Cycling", "Nutrition"];
const RECIPE_TYPES = ["Fuel", "Main dish", "Breakfast", "Soup", "Drinks", "Sauce", "Dessert"];
const BOOK_STATUSES = ["Read", "Currently reading", "Want to read"];
const ALLOWED_IMAGES = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function loadDatabase() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  data.books ||= [];
  return data;
}

function saveDatabase(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeSlug(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "novy-zapis";
}

function uniqueSlug(items, wantedSlug, oldSlug = "") {
  if (oldSlug && wantedSlug === oldSlug) return wantedSlug;
  const used = new Set(items.filter((item) => item.slug !== oldSlug).map((item) => item.slug));
  let slug = wantedSlug;
  let number = 2;
  while (used.has(slug)) {
    slug = `${wantedSlug}-${number}`;
    number += 1;
  }
  return slug;
}

function collectionName(itemType) {
  return {
    blog: "blog_posts",
    recipe: "recipes",
    route: "routes",
    book: "books",
  }[itemType];
}

function listUrlFor(itemType) {
  if (itemType === "blog") return "/blog";
  if (itemType === "book") return "/library";
  return "/databaza";
}

function findBySlug(items, slug) {
  return items.find((item) => item.slug === slug);
}

function cleanRichContent(html = "") {
  return html
    .replace(/<script.*?>.*?<\/script>/gis, "")
    .replace(/\son\w+=".*?"/gi, "")
    .replace(/\son\w+='.*?'/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
}

function splitLines(text = "") {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function extractImagesFromHtml(html = "") {
  return [...new Set([...html.matchAll(/\/img\/([^"']+)/g)].map((match) => match[1]))].sort();
}

function contentToHtml(item) {
  if (item.rich_content) return item.rich_content;
  const paragraphs = (item.content || []).map((line) => `<p>${escapeHtml(line)}</p>`);
  const images = (item.images || []).map((image) => `<img src="/img/${escapeHtml(image)}" alt="">`);
  return [...paragraphs, ...images].join("\n");
}

function extractIframeSrc(text = "") {
  const match = text.match(/src=["']([^"']+)["']/i);
  return (match ? match[1] : text).trim();
}

function mapyUrl(text = "") {
  const link = extractIframeSrc(text);
  return link.includes("mapy.cz") || link.includes("mapy.com") ? link : "";
}

function itemToForm(item) {
  return {
    title: item.title || item.name || "",
    slug: item.slug || "",
    date: item.date || "",
    category: item.category || "",
    type: item.type || "",
    ingredients: item.ingredients || "",
    place: item.place || "",
    distance: item.distance || "",
    difficulty: item.difficulty || "",
    mapy_link: item.mapy_link || "",
    strava_link: item.strava_link || "",
    author: item.author || "",
    language: item.language || "",
    status: item.status || "",
    finished_date: item.finished_date || "",
    cover_image: item.cover_image || "",
    summary: item.summary || "",
    rich_content: contentToHtml(item),
  };
}

function buildItemFromForm(itemType, items, fields, files, oldSlug = "") {
  const title = (fields.title || "").trim();
  const wantedSlug = (fields.slug || "").trim() || makeSlug(title);
  const slug = uniqueSlug(items, makeSlug(wantedSlug), oldSlug);
  const item = {
    slug,
    summary: (fields.summary || "").trim(),
    rich_content: cleanRichContent(fields.rich_content || ""),
    content: splitLines(fields.plain_content || ""),
    images: [],
  };
  item.images = extractImagesFromHtml(item.rich_content);

  if (itemType === "blog") {
    item.title = title;
    item.date = (fields.date || "").trim();
    item.category = (fields.category || "").trim();
  } else if (itemType === "recipe") {
    item.name = title;
    item.type = (fields.type || "").trim();
    item.ingredients = (fields.ingredients || "").trim();
  } else if (itemType === "route") {
    item.name = title;
    item.place = (fields.place || "").trim();
    item.distance = (fields.distance || "").trim();
    item.difficulty = (fields.difficulty || "").trim();
    item.mapy_link = mapyUrl(fields.mapy_link || "");
    item.strava_link = (fields.strava_link || "").trim();
  } else if (itemType === "book") {
    item.title = title;
    item.author = (fields.author || "").trim();
    item.language = (fields.language || "").trim();
    item.status = (fields.status || "").trim();
    item.finished_date = (fields.finished_date || "").trim();
    item.cover_image = (fields.cover_image || "").trim();
    if (files.cover_upload?.[0]?.filename) item.cover_image = saveUploadedFile(files.cover_upload[0]);
  }
  return item;
}

function secureName(filename = "image.png") {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_") || "image.png";
}

function uniqueUploadName(filename) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const clean = secureName(filename);
  const ext = path.extname(clean);
  const base = path.basename(clean, ext);
  let candidate = clean;
  let number = 2;
  while (fs.existsSync(path.join(UPLOAD_DIR, candidate))) {
    candidate = `${base}-${number}${ext}`;
    number += 1;
  }
  return candidate;
}

function saveUploadedFile(file) {
  const ext = path.extname(file.filename).toLowerCase();
  if (!ALLOWED_IMAGES.has(ext)) return "";
  const filename = uniqueUploadName(file.filename);
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.data);
  return `uploads/${filename}`;
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) return { fields: {}, files: {} };
  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  const fields = {};
  const files = {};
  let start = buffer.indexOf(boundary) + boundary.length + 2;
  while (start > boundary.length) {
    const end = buffer.indexOf(boundary, start);
    if (end < 0) break;
    const part = buffer.slice(start, end - 2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd >= 0) {
      const headers = part.slice(0, headerEnd).toString();
      const body = part.slice(headerEnd + 4);
      const name = headers.match(/name="([^"]+)"/)?.[1];
      const filename = headers.match(/filename="([^"]*)"/)?.[1];
      if (name && filename) {
        if (filename) {
          files[name] ||= [];
          files[name].push({ filename, data: body });
        }
      } else if (name) {
        fields[name] = body.toString().replace(/\r\n$/, "");
      }
    }
    start = end + boundary.length + 2;
  }
  return { fields, files };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function layout(title, body, active = "") {
  const nav = [
    ["Home", "/", "home"],
    ["About", "/about", "about"],
    ["Blog", "/blog", "blog"],
    ["Library", "/library", "library"],
    ["Databaza", "/databaza", "database"],
  ].map(([label, href, key]) => `<a class="${key === active ? "active" : ""}" href="${href}">${label}</a>`).join("");

  return `<!doctype html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title || "Mia's archive")}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <nav class="top-nav">
    <a class="brand" href="/">
      <img class="brand-icon" src="/img/ahoj.png" alt="">
      <span class="brand-name">Mia's archive</span>
    </a>
    <div class="nav-links">${nav}</div>
  </nav>
  <main>${body}</main>
  <footer class="site-footer">
    <p>Mia's archive &copy; 2026</p>
    <div class="footer-icons">
      <a href="https://www.strava.com/" aria-label="Strava"><img src="https://www.google.com/s2/favicons?domain=strava.com&sz=32" alt=""></a>
      <a href="https://open.spotify.com/" aria-label="Spotify"><img src="https://www.google.com/s2/favicons?domain=spotify.com&sz=32" alt=""></a>
      <a href="https://discord.com/" aria-label="Discord"><img src="https://www.google.com/s2/favicons?domain=discord.com&sz=32" alt=""></a>
    </div>
  </footer>
</body>
</html>`;
}

function actions(...links) {
  return `<div class="card-actions">${links.map(([label, href]) => `<a class="read-more" href="${href}">${label}</a>`).join("")}</div>`;
}

function homePage() {
  const data = loadDatabase();
  const posts = data.blog_posts.slice(0, 3).map((post) => `<article class="card">
    <p class="meta">${escapeHtml(post.date)} / ${escapeHtml(post.category)}</p>
    <h3>${escapeHtml(post.title)}</h3>
    <p>${escapeHtml(post.summary)}</p>
    ${actions(["Read full post", `/blog/${post.slug}`])}
  </article>`).join("");
  return layout("Mia's archive", `<section class="hero">
    <div class="hero-title">
      <h1>Mia's archive</h1>
      <p>"Halfway between a personal encyclopedia and an open diary, documenting the things that capture my attention."</p>
    </div>
  </section>
  <section class="home-latest">
    <div class="section-heading"><p>fresh from the archive</p><h2>Latest posts</h2></div>
    <div class="grid">${posts}</div>
  </section>`, "home");
}

function aboutPage() {
  return layout("About", `<section class="page">
    <h1>About</h1>
    <p>Toto je miesto pre moj osobny blog, recepty, poznamky, trasy a vsetko, co si chcem ulozit na jedno mile miesto.</p>
  </section>`, "about");
}

function blogPage() {
  const data = loadDatabase();
  const posts = data.blog_posts.map((post) => `<article class="card">
    <p class="meta">${escapeHtml(post.date)} / ${escapeHtml(post.category)}</p>
    <h2>${escapeHtml(post.title)}</h2>
    <p>${escapeHtml(post.summary)}</p>
    ${actions(["Read full post", `/blog/${post.slug}`], ["Edit", `/edit/blog/${post.slug}`])}
  </article>`).join("");
  return layout("Blog", `<section class="page">
    <div class="page-heading"><h1>Blog</h1><a class="read-more" href="/add/blog">Add blog post</a></div>
    <div class="grid">${posts}</div>
  </section>`, "blog");
}

function databasePage() {
  const data = loadDatabase();
  const recipes = data.recipes.map((recipe) => `<article class="card">
    <p class="meta">${escapeHtml(recipe.type)}</p>
    <h3>${escapeHtml(recipe.name)}</h3>
    <p><strong>Ingrediencie:</strong> ${escapeHtml(recipe.ingredients)}</p>
    <p>${escapeHtml(recipe.summary)}</p>
    ${actions(["Open recipe", `/recept/${recipe.slug}`], ["Edit", `/edit/recipe/${recipe.slug}`])}
  </article>`).join("");
  const routes = data.routes.map((route) => `<article class="card">
    <p class="meta">${escapeHtml(route.place)} / ${escapeHtml(route.distance)} / ${escapeHtml(route.difficulty)}</p>
    <h3>${escapeHtml(route.name)}</h3>
    <p>${escapeHtml(route.summary)}</p>
    ${actions(["Open route", `/trasa/${route.slug}`], ["Edit", `/edit/route/${route.slug}`])}
  </article>`).join("");
  return layout("Database", `<section class="page">
    <div class="page-heading"><h1>Database</h1></div>
    <div class="section-row"><h2>Recepty</h2><a class="read-more" href="/add/recipe">Add recipe</a></div>
    <div class="grid">${recipes}</div>
    <div class="section-row"><h2>Trasy</h2><a class="read-more" href="/add/route">Add route</a></div>
    <div class="grid">${routes}</div>
  </section>`, "database");
}

function libraryPage(url) {
  const data = loadDatabase();
  const selected = url.searchParams.get("status") || "Read";
  let books = data.books.filter((book) => book.status === selected);
  books = selected === "Read"
    ? books.sort((a, b) => String(b.finished_date || "").localeCompare(String(a.finished_date || "")))
    : books.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  const filters = BOOK_STATUSES.map((status) => `<a class="${status === selected ? "active" : ""}" href="/library?status=${encodeURIComponent(status)}">${status}</a>`).join("");
  const cards = books.map((book) => {
    const cover = book.cover_image ? `<img class="book-cover" src="/img/${escapeHtml(book.cover_image)}" alt="">` : `<div class="book-cover book-cover-empty">No cover</div>`;
    const language = book.language ? `<span>${escapeHtml(book.language)}</span>` : "";
    const finished = book.status === "Read" && book.finished_date ? `<p class="book-finished">Finished ${escapeHtml(book.finished_date)}</p>` : "";
    return `<article class="book-card">${cover}<div class="book-info">
      <div class="book-topline"><span>${escapeHtml(book.status)}</span>${language}</div>
      <h2>${escapeHtml(book.title)}</h2>
      <p class="book-author">${escapeHtml(book.author)}</p>
      ${finished}
      <p class="book-summary">${escapeHtml(book.summary)}</p>
      ${actions(["Open book", `/book/${book.slug}`], ["Edit", `/edit/book/${book.slug}`])}
    </div></article>`;
  }).join("");
  return layout("Library", `<section class="page">
    <div class="library-heading"><h1>Library</h1><a class="read-more" href="/add/book">Add book</a></div>
    <div class="library-filters">${filters}</div>
    <div class="book-grid">${cards}</div>
  </section>`, "library");
}

function detailPage(itemType, slug) {
  const data = loadDatabase();
  const collection = data[collectionName(itemType)];
  const item = findBySlug(collection, slug);
  if (!item) return null;
  let intro = "";
  let extra = "";
  if (itemType === "blog") {
    intro = `<p class="meta">${escapeHtml(item.date)} / ${escapeHtml(item.category)}</p><h1>${escapeHtml(item.title)}</h1>`;
  } else if (itemType === "recipe") {
    intro = `<p class="meta">${escapeHtml(item.type)}</p><h1>${escapeHtml(item.name)}</h1><p><strong>Ingrediencie:</strong> ${escapeHtml(item.ingredients)}</p>`;
  } else if (itemType === "route") {
    const mapUrl = mapyUrl(item.mapy_link || "");
    const mapLink = mapUrl ? `<a class="read-more" href="${escapeHtml(mapUrl)}" target="_blank" rel="noreferrer">Open Mapy.cz</a>` : "";
    const strava = item.strava_link ? `<a class="read-more" href="${escapeHtml(item.strava_link)}" target="_blank" rel="noreferrer">Open Strava</a>` : "";
    const iframe = mapUrl ? `<iframe class="route-map" src="${escapeHtml(mapUrl)}" loading="lazy"></iframe>` : "";
    intro = `<p class="meta">${escapeHtml(item.place)} / ${escapeHtml(item.distance)} / ${escapeHtml(item.difficulty)}</p><h1>${escapeHtml(item.name)}</h1>`;
    extra = `<div class="route-links">${mapLink}${strava}</div>${iframe}`;
  } else {
    const finished = item.status === "Read" && item.finished_date ? `<p><strong>Finished:</strong> ${escapeHtml(item.finished_date)}</p>` : "";
    const cover = item.cover_image ? `<img class="book-detail-cover" src="/img/${escapeHtml(item.cover_image)}" alt="">` : "";
    intro = `<p class="meta">${escapeHtml(item.status)} / ${escapeHtml(item.language)}</p><h1>${escapeHtml(item.title)}</h1><p><strong>Author:</strong> ${escapeHtml(item.author)}</p>${finished}`;
    extra = cover;
  }
  return layout(item.title || item.name, `<article class="page detail-page">
    ${intro}
    ${extra}
    <div class="detail-text rich-content">${contentToHtml(item)}</div>
    <a class="read-more" href="/edit/${itemType}/${item.slug}">Edit</a>
    <a class="read-more" href="${listUrlFor(itemType)}">Back</a>
  </article>`, itemType === "book" ? "library" : itemType === "blog" ? "blog" : "database");
}

function selectOptions(options, selected) {
  return options.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
}

function itemFormPage(itemType, form = {}, editing = false) {
  const labels = { blog: "blog post", recipe: "recipe", route: "route", book: "book" };
  const formFields = {
    blog: `<label>Date<input name="date" value="${escapeHtml(form.date)}" placeholder="2026-06-04"></label>
      <label>Category<select name="category">${selectOptions(BLOG_CATEGORIES, form.category)}</select></label>`,
    recipe: `<label>Type<select name="type">${selectOptions(RECIPE_TYPES, form.type)}</select></label>
      <label>Ingredients<input name="ingredients" value="${escapeHtml(form.ingredients)}" placeholder="cestoviny, syr, paradajky"></label>`,
    route: `<label>Place<input name="place" value="${escapeHtml(form.place)}" placeholder="dopln miesto"></label>
      <label>Distance<input name="distance" value="${escapeHtml(form.distance)}" placeholder="7 km"></label>
      <label>Difficulty<input name="difficulty" value="${escapeHtml(form.difficulty)}" placeholder="lahka"></label>
      <label>Mapy.cz / Mapy.com link or iframe<input name="mapy_link" value="${escapeHtml(form.mapy_link)}" placeholder='https://mapy.com/... alebo <iframe src="https://mapy.com/..."></iframe>'></label>
      <label>Strava link<input name="strava_link" value="${escapeHtml(form.strava_link)}" placeholder="https://www.strava.com/..."></label>`,
    book: `<label>Author<input name="author" value="${escapeHtml(form.author)}" placeholder="Ursula K. Le Guin"></label>
      <label>Language<input name="language" value="${escapeHtml(form.language)}" placeholder="English / Slovak / Czech"></label>
      <label>Category<select name="status">${selectOptions(BOOK_STATUSES, form.status)}</select></label>
      <label>Finished date<input type="date" name="finished_date" value="${escapeHtml(form.finished_date)}"></label>
      <label>Book cover<input type="file" name="cover_upload" accept="image/*"></label>
      ${form.cover_image ? `<div class="cover-preview"><img src="/img/${escapeHtml(form.cover_image)}" alt=""><input type="hidden" name="cover_image" value="${escapeHtml(form.cover_image)}"></div>` : '<input type="hidden" name="cover_image" value="">'}`
  }[itemType];
  return layout(`${editing ? "Edit" : "Add"} ${labels[itemType]}`, `<section class="page">
    <h1>${editing ? "Edit" : "Add"} ${labels[itemType]}</h1>
    <form class="content-form" method="post" enctype="multipart/form-data">
      <label>Title / name<input name="title" value="${escapeHtml(form.title)}" required></label>
      <label>Slug<input name="slug" value="${escapeHtml(form.slug)}" placeholder="napr. vylet-do-lesa"></label>
      ${formFields}
      <label>Short summary<textarea name="summary" rows="3">${escapeHtml(form.summary)}</textarea></label>
      <div class="editor-field">
        <p class="field-title">${itemType === "book" ? "Review / thoughts" : "Full text"}</p>
        <div class="editor-toolbar">
          <button type="button" data-command="bold">Bold</button>
          <label class="color-tool">Color<input id="text-color" type="color" value="#ffbce2"></label>
          <button type="button" id="upload-trigger">Add image</button>
          <input id="image-upload" type="file" accept="image/*" multiple hidden>
        </div>
        <div id="rich-editor" class="rich-editor" contenteditable="true">${form.rich_content || ""}</div>
        <input id="rich-content" type="hidden" name="rich_content">
        <textarea id="plain-content" name="plain_content" hidden></textarea>
        <p class="help-text">Tip: obrazok sa vlozi tam, kde mas kurzor. Text vies oznacit a dat Bold alebo vybrat farbu.</p>
      </div>
      <div class="form-actions"><button type="submit">Save</button><a class="read-more" href="${listUrlFor(itemType)}">Cancel</a></div>
    </form>
  </section>${editorScript()}`, itemType === "book" ? "library" : itemType === "blog" ? "blog" : "database");
}

function editorScript() {
  return `<script>
const editor = document.getElementById("rich-editor");
const richContent = document.getElementById("rich-content");
const plainContent = document.getElementById("plain-content");
const imageUpload = document.getElementById("image-upload");
document.querySelector("[data-command='bold']").addEventListener("click", () => {
  document.execCommand("bold", false, null);
  editor.focus();
});
document.getElementById("text-color").addEventListener("input", (event) => {
  document.execCommand("foreColor", false, event.target.value);
  editor.focus();
});
document.getElementById("upload-trigger").addEventListener("click", () => imageUpload.click());
imageUpload.addEventListener("change", async () => {
  const formData = new FormData();
  for (const file of imageUpload.files) formData.append("images", file);
  const response = await fetch("/upload-image", { method: "POST", body: formData });
  const data = await response.json();
  for (const image of data.images) document.execCommand("insertHTML", false, '<img src="' + image.url + '" alt="">');
  imageUpload.value = "";
  editor.focus();
});
document.querySelector(".content-form").addEventListener("submit", () => {
  richContent.value = editor.innerHTML;
  plainContent.value = editor.innerText;
});
</script>`;
}

function send(res, status, body, type = "text/html; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function serveFile(res, baseDir, urlPath) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(baseDir, safePath);
  if (!filePath.startsWith(baseDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = { ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ttf": "font/ttf" };
  send(res, 200, fs.readFileSync(filePath), types[ext] || "application/octet-stream");
}

async function handleSave(req, res, itemType, slug = "") {
  const body = await readBody(req);
  const parsed = parseMultipart(body, req.headers["content-type"] || "");
  const data = loadDatabase();
  const collection = data[collectionName(itemType)];
  if (!collection) return send(res, 404, "Not found", "text/plain");
  if (slug) {
    const current = findBySlug(collection, slug);
    if (!current) return send(res, 404, "Not found", "text/plain");
    const index = collection.indexOf(current);
    collection[index] = buildItemFromForm(itemType, collection, parsed.fields, parsed.files, slug);
  } else {
    collection.unshift(buildItemFromForm(itemType, collection, parsed.fields, parsed.files));
  }
  saveDatabase(data);
  redirect(res, listUrlFor(itemType));
}

async function uploadImage(req, res) {
  const body = await readBody(req);
  const parsed = parseMultipart(body, req.headers["content-type"] || "");
  const images = Object.values(parsed.files)
    .flat()
    .map(saveUploadedFile)
    .filter(Boolean)
    .map((filename) => ({ filename, url: `/img/${filename}` }));
  send(res, 200, JSON.stringify({ images }), "application/json; charset=utf-8");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  if (pathname.startsWith("/static/")) return serveFile(res, path.join(ROOT, "static"), pathname.slice("/static/".length));
  if (pathname.startsWith("/img/")) return serveFile(res, path.join(ROOT, "img"), pathname.slice("/img/".length));
  if (pathname.startsWith("/fonts/")) return serveFile(res, path.join(ROOT, "fonts"), pathname.slice("/fonts/".length));
  if (req.method === "POST" && pathname === "/upload-image") return uploadImage(req, res);

  const addMatch = pathname.match(/^\/add\/(blog|recipe|route|book)$/);
  if (addMatch && req.method === "POST") return handleSave(req, res, addMatch[1]);
  if (addMatch) return send(res, 200, itemFormPage(addMatch[1], {}, false));

  const editMatch = pathname.match(/^\/edit\/(blog|recipe|route|book)\/([^/]+)$/);
  if (editMatch && req.method === "POST") return handleSave(req, res, editMatch[1], editMatch[2]);
  if (editMatch) {
    const data = loadDatabase();
    const item = findBySlug(data[collectionName(editMatch[1])], editMatch[2]);
    return item ? send(res, 200, itemFormPage(editMatch[1], itemToForm(item), true)) : send(res, 404, "Not found", "text/plain");
  }

  if (pathname === "/") return send(res, 200, homePage());
  if (pathname === "/about") return send(res, 200, aboutPage());
  if (pathname === "/blog") return send(res, 200, blogPage());
  if (pathname === "/databaza") return send(res, 200, databasePage());
  if (pathname === "/library") return send(res, 200, libraryPage(url));

  const detailPatterns = [
    [/^\/blog\/([^/]+)$/, "blog"],
    [/^\/recept\/([^/]+)$/, "recipe"],
    [/^\/trasa\/([^/]+)$/, "route"],
    [/^\/book\/([^/]+)$/, "book"],
  ];
  for (const [pattern, type] of detailPatterns) {
    const match = pathname.match(pattern);
    if (match) {
      const page = detailPage(type, match[1]);
      return page ? send(res, 200, page) : send(res, 404, "Not found", "text/plain");
    }
  }

  send(res, 404, "Not found", "text/plain; charset=utf-8");
});

server.listen(PORT, () => {
  console.log(`Mia's archive running at http://127.0.0.1:${PORT}`);
});
