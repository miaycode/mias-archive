import html
import json
import re
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"
DATA = ROOT / "data" / "database.json"
STYLE = ROOT / "static" / "style.css"


def load_data():
    with DATA.open(encoding="utf-8") as file:
        data = json.load(file)
    data.setdefault("books", [])
    return data


def clean_out():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    shutil.copytree(ROOT / "img", OUT / "img")
    shutil.copytree(ROOT / "fonts", OUT / "fonts")


def esc(value):
    return html.escape(str(value or ""))


def page_depth(path):
    parts = Path(path).parts
    if parts[-1] == "index.html":
        return len(parts) - 1
    return len(parts) - 1


def prefix_for(path):
    depth = page_depth(path)
    return "./" if depth == 0 else "../" * depth


def static_css(prefix):
    css = STYLE.read_text(encoding="utf-8")
    css = css.replace('url("/fonts/', f'url("{prefix}fonts/')
    css = css.replace('url("/img/', f'url("{prefix}img/')
    css = re.sub(r"\.read-more\s*\{", ".read-more {\n    align-items: center;", css, count=1)
    return css


def fix_content_links(content, prefix):
    content = content or ""
    content = content.replace('src="/img/', f'src="{prefix}img/')
    content = content.replace('href="/img/', f'href="{prefix}img/')
    return content


def content_html(item, prefix):
    if item.get("rich_content"):
        return fix_content_links(item["rich_content"], prefix)

    parts = [f"<p>{esc(paragraph)}</p>" for paragraph in item.get("content", [])]
    for image in item.get("images", []):
        parts.append(f'<img class="detail-image" src="{prefix}img/{esc(image)}" alt="">')
    return "\n".join(parts)


def route_map_url(text):
    text = text or ""
    match = re.search(r'src=["\']([^"\']+)["\']', text, flags=re.IGNORECASE)
    link = match.group(1).strip() if match else text.strip()
    if "mapy.cz" in link or "mapy.com" in link:
        return link
    return ""


def write_page(path, title, body, active=""):
    prefix = prefix_for(path)
    css = static_css(prefix)
    nav = [
        ("Home", f"{prefix}index.html", "home"),
        ("About", f"{prefix}about.html", "about"),
        ("Blog", f"{prefix}blog/index.html", "blog"),
        ("Library", f"{prefix}library/index.html", "library"),
        ("Databaza", f"{prefix}database/index.html", "database"),
    ]
    links = "\n".join(
        f'<a class="{"active" if key == active else ""}" href="{href}">{label}</a>'
        for label, href, key in nav
    )
    html_doc = f"""<!doctype html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{esc(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>{css}</style>
</head>
<body>
    <nav class="top-nav">
        <a class="brand" href="{prefix}index.html">
            <img class="brand-icon" src="{prefix}img/ahoj.png" alt="">
            <span class="brand-name">Mia's archive</span>
        </a>
        <div class="nav-links">{links}</div>
    </nav>
    <main>{body}</main>
    <footer class="site-footer">
        <p>Mia's archive &copy; 2026</p>
        <div class="footer-icons">
            <a href="https://www.strava.com/" aria-label="Strava"><img src="https://www.google.com/s2/favicons?domain=strava.com&sz=32" alt=""></a>
            <a href="https://open.spotify.com/" aria-label="Spotify"><img src="https://www.google.com/s2/favicons?domain=spotify.com&sz=32" alt=""></a>
            <a href="https://discord.com/" aria-label="Discord"><img src="https://www.google.com/s2/favicons?domain=discord.com&sz=32" alt=""></a>
        </div>
    </footer>
</body>
</html>
"""
    out_path = OUT / path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html_doc, encoding="utf-8")


def card_actions(*links):
    return '<div class="card-actions">' + "".join(
        f'<a class="read-more" href="{href}">{label}</a>' for label, href in links
    ) + "</div>"


def build_home(data):
    posts = data["blog_posts"][:3]
    latest = []
    for post in posts:
        latest.append(
            f"""<article class="card">
                <p class="meta">{esc(post.get("date"))} / {esc(post.get("category"))}</p>
                <h3>{esc(post.get("title"))}</h3>
                <p>{esc(post.get("summary"))}</p>
                {card_actions(("Read full post", f"blog/{post['slug']}/index.html"))}
            </article>"""
        )
    body = f"""
<section class="hero">
    <div class="hero-title">
        <h1>Mia's archive</h1>
        <p>"Halfway between a personal encyclopedia and an open diary, documenting the things that capture my attention."</p>
    </div>
</section>
<section class="home-latest">
    <div class="section-heading">
        <p>fresh from the archive</p>
        <h2>Latest posts</h2>
    </div>
    <div class="grid">{''.join(latest)}</div>
</section>
"""
    write_page("index.html", "Mia's archive", body, "home")


def build_about():
    body = """
<section class="page">
    <h1>About</h1>
    <p>Toto je miesto pre moj osobny blog, recepty, poznamky, trasy a vsetko, co si chcem ulozit na jedno mile miesto.</p>
    <p>Staticka verzia funguje bez Python servera a je vhodna pre GitHub Pages.</p>
</section>
"""
    write_page("about.html", "About", body, "about")


def build_blog(data):
    cards = []
    for post in data["blog_posts"]:
        cards.append(
            f"""<article class="card">
                <p class="meta">{esc(post.get("date"))} / {esc(post.get("category"))}</p>
                <h2>{esc(post.get("title"))}</h2>
                <p>{esc(post.get("summary"))}</p>
                {card_actions(("Read full post", f"{post['slug']}/index.html"))}
            </article>"""
        )
    body = f"""
<section class="page">
    <div class="page-heading"><h1>Blog</h1></div>
    <div class="grid">{''.join(cards)}</div>
</section>
"""
    write_page("blog/index.html", "Blog", body, "blog")

    for post in data["blog_posts"]:
        prefix = prefix_for(f"blog/{post['slug']}/index.html")
        body = f"""
<article class="page detail-page">
    <p class="meta">{esc(post.get("date"))} / {esc(post.get("category"))}</p>
    <h1>{esc(post.get("title"))}</h1>
    <div class="detail-text rich-content">{content_html(post, prefix)}</div>
    <a class="read-more" href="../index.html">Back to blog</a>
</article>
"""
        write_page(f"blog/{post['slug']}/index.html", post.get("title", "Blog post"), body, "blog")


def build_database(data):
    recipe_cards = []
    for recipe in data["recipes"]:
        recipe_cards.append(
            f"""<article class="card">
                <p class="meta">{esc(recipe.get("type"))}</p>
                <h3>{esc(recipe.get("name"))}</h3>
                <p><strong>Ingrediencie:</strong> {esc(recipe.get("ingredients"))}</p>
                <p>{esc(recipe.get("summary"))}</p>
                {card_actions(("Open recipe", f"../recipe/{recipe['slug']}/index.html"))}
            </article>"""
        )

    route_cards = []
    for route in data["routes"]:
        route_cards.append(
            f"""<article class="card">
                <p class="meta">{esc(route.get("place"))} / {esc(route.get("distance"))} / {esc(route.get("difficulty"))}</p>
                <h3>{esc(route.get("name"))}</h3>
                <p>{esc(route.get("summary"))}</p>
                {card_actions(("Open route", f"../route/{route['slug']}/index.html"))}
            </article>"""
        )

    body = f"""
<section class="page">
    <div class="page-heading"><h1>Database</h1></div>
    <div class="section-row"><h2>Recepty</h2></div>
    <div class="grid">{''.join(recipe_cards)}</div>
    <div class="section-row"><h2>Trasy</h2></div>
    <div class="grid">{''.join(route_cards)}</div>
</section>
"""
    write_page("database/index.html", "Database", body, "database")

    for recipe in data["recipes"]:
        prefix = prefix_for(f"recipe/{recipe['slug']}/index.html")
        body = f"""
<article class="page detail-page">
    <p class="meta">{esc(recipe.get("type"))}</p>
    <h1>{esc(recipe.get("name"))}</h1>
    <p><strong>Ingrediencie:</strong> {esc(recipe.get("ingredients"))}</p>
    <div class="detail-text rich-content">{content_html(recipe, prefix)}</div>
    <a class="read-more" href="../../database/index.html">Back to database</a>
</article>
"""
        write_page(f"recipe/{recipe['slug']}/index.html", recipe.get("name", "Recipe"), body, "database")

    for route in data["routes"]:
        prefix = prefix_for(f"route/{route['slug']}/index.html")
        map_url = route_map_url(route.get("mapy_link"))
        links = []
        if map_url:
            links.append(f'<a class="read-more" href="{esc(map_url)}" target="_blank" rel="noreferrer">Open Mapy.cz</a>')
        if route.get("strava_link"):
            links.append(f'<a class="read-more" href="{esc(route["strava_link"])}" target="_blank" rel="noreferrer">Open Strava</a>')
        iframe = f'<iframe class="route-map" src="{esc(map_url)}" loading="lazy"></iframe>' if map_url else ""
        body = f"""
<article class="page detail-page">
    <p class="meta">{esc(route.get("place"))} / {esc(route.get("distance"))} / {esc(route.get("difficulty"))}</p>
    <h1>{esc(route.get("name"))}</h1>
    <div class="route-links">{''.join(links)}</div>
    {iframe}
    <div class="detail-text rich-content">{content_html(route, prefix)}</div>
    <a class="read-more" href="../../database/index.html">Back to database</a>
</article>
"""
        write_page(f"route/{route['slug']}/index.html", route.get("name", "Route"), body, "database")


def book_card(book, prefix):
    cover = (
        f'<img class="book-cover" src="{prefix}img/{esc(book.get("cover_image"))}" alt="">'
        if book.get("cover_image")
        else '<div class="book-cover book-cover-empty">No cover</div>'
    )
    finished = (
        f'<p class="book-finished">Finished {esc(book.get("finished_date"))}</p>'
        if book.get("status") == "Read" and book.get("finished_date")
        else ""
    )
    language = f'<span>{esc(book.get("language"))}</span>' if book.get("language") else ""
    return f"""<article class="book-card">
        {cover}
        <div class="book-info">
            <div class="book-topline"><span>{esc(book.get("status"))}</span>{language}</div>
            <h2>{esc(book.get("title"))}</h2>
            <p class="book-author">{esc(book.get("author"))}</p>
            {finished}
            <p class="book-summary">{esc(book.get("summary"))}</p>
            {card_actions(("Open book", f"../book/{book['slug']}/index.html"))}
        </div>
    </article>"""


def build_library(data):
    statuses = ["Read", "Currently reading", "Want to read"]

    def sorted_books(status):
        books = [book for book in data["books"] if book.get("status") == status]
        if status == "Read":
            return sorted(books, key=lambda book: book.get("finished_date", ""), reverse=True)
        return sorted(books, key=lambda book: book.get("title", "").lower())

    for status in statuses:
        slug = status.lower().replace(" ", "-")
        filters = "".join(
            f'<a class="{"active" if item == status else ""}" href="../library/{item.lower().replace(" ", "-")}.html">{item}</a>'
            for item in statuses
        )
        cards = "".join(book_card(book, "../") for book in sorted_books(status))
        body = f"""
<section class="page">
    <div class="library-heading"><h1>Library</h1></div>
    <div class="library-filters">{filters}</div>
    <div class="book-grid">{cards}</div>
</section>
"""
        write_page(f"library/{slug}.html", "Library", body, "library")

    filters = "".join(
        f'<a class="{"active" if item == "Read" else ""}" href="../library/{item.lower().replace(" ", "-")}.html">{item}</a>'
        for item in statuses
    )
    read_cards = "".join(book_card(book, "../") for book in sorted_books("Read"))
    body = f"""
<section class="page">
    <div class="library-heading"><h1>Library</h1></div>
    <div class="library-filters">{filters}</div>
    <div class="book-grid">{read_cards}</div>
</section>
"""
    write_page("library/index.html", "Library", body, "library")

    for book in data["books"]:
        prefix = prefix_for(f"book/{book['slug']}/index.html")
        cover = (
            f'<img class="book-detail-cover" src="{prefix}img/{esc(book.get("cover_image"))}" alt="">'
            if book.get("cover_image")
            else ""
        )
        finished = (
            f'<p><strong>Finished:</strong> {esc(book.get("finished_date"))}</p>'
            if book.get("status") == "Read" and book.get("finished_date")
            else ""
        )
        body = f"""
<article class="page detail-page">
    <p class="meta">{esc(book.get("status"))} / {esc(book.get("language"))}</p>
    <h1>{esc(book.get("title"))}</h1>
    <p><strong>Author:</strong> {esc(book.get("author"))}</p>
    {finished}
    {cover}
    <div class="detail-text rich-content">{content_html(book, prefix)}</div>
    <a class="read-more" href="../../library/index.html">Back to library</a>
</article>
"""
        write_page(f"book/{book['slug']}/index.html", book.get("title", "Book"), body, "library")


def main():
    data = load_data()
    clean_out()
    build_home(data)
    build_about()
    build_blog(data)
    build_database(data)
    build_library(data)


if __name__ == "__main__":
    main()
