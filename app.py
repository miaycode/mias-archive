import json
import re
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, render_template, request, send_from_directory, url_for
from werkzeug.utils import secure_filename

app = Flask(__name__)
DATA_FILE = Path("data/database.json")
UPLOAD_FOLDER = Path("img/uploads")
BLOG_CATEGORIES = ["Diary", "Philosophy", "Running", "Cycling", "Nutrition"]
RECIPE_TYPES = ["Fuel", "Main dish", "Breakfast", "Soup", "Drinks", "Sauce", "Dessert"]
BOOK_STATUSES = ["Read", "Currently reading", "Want to read"]
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp"}


def load_database():
    with DATA_FILE.open(encoding="utf-8") as file:
        data = json.load(file)
    data.setdefault("books", [])
    return data


def save_database(data):
    with DATA_FILE.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def find_by_slug(items, slug):
    for item in items:
        if item["slug"] == slug:
            return item
    abort(404)


def make_slug(text):
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "novy-zapis"


def unique_slug(items, wanted_slug, old_slug=None):
    if old_slug and wanted_slug == old_slug:
        return wanted_slug

    used_slugs = {item["slug"] for item in items if item["slug"] != old_slug}
    slug = wanted_slug
    number = 2
    while slug in used_slugs:
        slug = f"{wanted_slug}-{number}"
        number += 1
    return slug


def split_lines(text):
    return [line.strip() for line in text.splitlines() if line.strip()]


def split_images(text):
    return [image.strip() for image in text.split(",") if image.strip()]


def allowed_image(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def unique_upload_name(filename):
    UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
    clean_name = secure_filename(filename)
    if not clean_name:
        clean_name = "image.png"

    path = UPLOAD_FOLDER / clean_name
    if not path.exists():
        return clean_name

    stem = path.stem
    suffix = path.suffix
    number = 2
    while True:
        new_name = f"{stem}-{number}{suffix}"
        if not (UPLOAD_FOLDER / new_name).exists():
            return new_name
        number += 1


def save_uploaded_image(file):
    if not file or not file.filename or not allowed_image(file.filename):
        return ""

    filename = unique_upload_name(file.filename)
    file.save(UPLOAD_FOLDER / filename)
    return f"uploads/{filename}"


def clean_rich_content(html):
    html = re.sub(r"<script.*?>.*?</script>", "", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"\son\w+=\".*?\"", "", html, flags=re.IGNORECASE)
    html = re.sub(r"\son\w+='.*?'", "", html, flags=re.IGNORECASE)
    html = re.sub(r"javascript:", "", html, flags=re.IGNORECASE)
    return html.strip()


def content_to_html(item):
    if item.get("rich_content"):
        return item["rich_content"]

    parts = []
    for paragraph in item.get("content", []):
        parts.append(f"<p>{paragraph}</p>")
    for image in item.get("images", []):
        parts.append(f'<img src="{url_for("image_file", filename=image)}" alt="">')
    return "\n".join(parts)


def extract_images_from_html(html):
    matches = re.findall(r'/img/([^"\']+)', html)
    return sorted(set(matches))


def extract_iframe_src(text):
    match = re.search(r'src=["\']([^"\']+)["\']', text, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return text.strip()


def mapy_url(text):
    link = extract_iframe_src(text)
    if "mapy.cz" not in link and "mapy.com" not in link:
        return ""
    return link


def item_to_form(item, item_type):
    title = item.get("title") or item.get("name", "")
    return {
        "title": title,
        "slug": item.get("slug", ""),
        "date": item.get("date", ""),
        "category": item.get("category", ""),
        "type": item.get("type", ""),
        "ingredients": item.get("ingredients", ""),
        "place": item.get("place", ""),
        "distance": item.get("distance", ""),
        "difficulty": item.get("difficulty", ""),
        "mapy_link": item.get("mapy_link", ""),
        "strava_link": item.get("strava_link", ""),
        "author": item.get("author", ""),
        "language": item.get("language", ""),
        "status": item.get("status", ""),
        "finished_date": item.get("finished_date", ""),
        "cover_image": item.get("cover_image", ""),
        "summary": item.get("summary", ""),
        "rich_content": content_to_html(item),
        "content": "\n".join(item.get("content", [])),
        "images": ", ".join(item.get("images", [])),
        "item_type": item_type,
    }


def build_item_from_form(item_type, items, old_slug=None):
    title = request.form.get("title", "").strip()
    wanted_slug = request.form.get("slug", "").strip() or make_slug(title)
    slug = unique_slug(items, make_slug(wanted_slug), old_slug)

    base_item = {
        "slug": slug,
        "summary": request.form.get("summary", "").strip(),
        "rich_content": clean_rich_content(request.form.get("rich_content", "")),
        "content": split_lines(request.form.get("plain_content", "")),
        "images": [],
    }
    base_item["images"] = extract_images_from_html(base_item["rich_content"])

    if item_type == "blog":
        base_item.update(
            {
                "title": title,
                "date": request.form.get("date", "").strip(),
                "category": request.form.get("category", "").strip(),
            }
        )
    elif item_type == "recipe":
        base_item.update(
            {
                "name": title,
                "type": request.form.get("type", "").strip(),
                "ingredients": request.form.get("ingredients", "").strip(),
            }
        )
    elif item_type == "route":
        base_item.update(
            {
                "name": title,
                "place": request.form.get("place", "").strip(),
                "distance": request.form.get("distance", "").strip(),
                "difficulty": request.form.get("difficulty", "").strip(),
                "mapy_link": mapy_url(request.form.get("mapy_link", "")),
                "strava_link": request.form.get("strava_link", "").strip(),
            }
        )
    elif item_type == "book":
        cover_image = request.form.get("cover_image", "").strip()
        uploaded_cover = save_uploaded_image(request.files.get("cover_upload"))
        if uploaded_cover:
            cover_image = uploaded_cover

        base_item.update(
            {
                "title": title,
                "author": request.form.get("author", "").strip(),
                "language": request.form.get("language", "").strip(),
                "status": request.form.get("status", "").strip(),
                "finished_date": request.form.get("finished_date", "").strip(),
                "cover_image": cover_image,
            }
        )
    else:
        abort(404)

    return base_item


def collection_name(item_type):
    names = {
        "blog": "blog_posts",
        "recipe": "recipes",
        "route": "routes",
        "book": "books",
    }
    if item_type not in names:
        abort(404)
    return names[item_type]


def list_url_for(item_type):
    if item_type == "blog":
        return url_for("blog")
    if item_type == "book":
        return url_for("library")
    return url_for("database")


@app.route("/")
def home():
    data = load_database()
    return render_template("home.html", latest_posts=data["blog_posts"][:3])


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/blog")
def blog():
    data = load_database()
    return render_template("blog.html", posts=data["blog_posts"])


@app.route("/blog/<slug>")
def blog_post(slug):
    data = load_database()
    post = find_by_slug(data["blog_posts"], slug)
    return render_template("post_detail.html", item=post, item_type="blog")


@app.route("/databaza")
def database():
    data = load_database()
    return render_template(
        "database.html",
        recipes=data["recipes"],
        routes=data["routes"],
    )


@app.route("/library")
def library():
    data = load_database()
    selected_status = request.args.get("status", "Read")
    books = data["books"]
    if selected_status in BOOK_STATUSES:
        books = [book for book in books if book.get("status") == selected_status]

    if selected_status == "Read":
        books = sorted(books, key=lambda book: book.get("finished_date", ""), reverse=True)
    else:
        books = sorted(books, key=lambda book: book.get("title", "").lower())

    return render_template(
        "library.html",
        books=books,
        selected_status=selected_status,
        book_statuses=BOOK_STATUSES,
    )


@app.route("/book/<slug>")
def book_detail(slug):
    data = load_database()
    book = find_by_slug(data["books"], slug)
    return render_template("post_detail.html", item=book, item_type="book")


@app.route("/recept/<slug>")
def recipe_detail(slug):
    data = load_database()
    recipe = find_by_slug(data["recipes"], slug)
    return render_template("post_detail.html", item=recipe, item_type="recipe")


@app.route("/trasa/<slug>")
def route_detail(slug):
    data = load_database()
    route = find_by_slug(data["routes"], slug)
    route["mapy_embed_url"] = mapy_url(route.get("mapy_link", ""))
    route["mapy_display_url"] = route["mapy_embed_url"]
    return render_template("post_detail.html", item=route, item_type="route")


@app.route("/add/<item_type>", methods=["GET", "POST"])
def add_item(item_type):
    data = load_database()
    items = data[collection_name(item_type)]

    if request.method == "POST":
        items.insert(0, build_item_from_form(item_type, items))
        save_database(data)
        return redirect(list_url_for(item_type))

    return render_template(
        "item_form.html",
        item_type=item_type,
        form={},
        return_url=list_url_for(item_type),
        blog_categories=BLOG_CATEGORIES,
        recipe_types=RECIPE_TYPES,
        book_statuses=BOOK_STATUSES,
    )


@app.route("/edit/<item_type>/<slug>", methods=["GET", "POST"])
def edit_item(item_type, slug):
    data = load_database()
    items = data[collection_name(item_type)]
    item = find_by_slug(items, slug)

    if request.method == "POST":
        new_item = build_item_from_form(item_type, items, old_slug=slug)
        item_index = items.index(item)
        items[item_index] = new_item
        save_database(data)
        return redirect(list_url_for(item_type))

    return render_template(
        "item_form.html",
        item_type=item_type,
        form=item_to_form(item, item_type),
        editing=True,
        return_url=list_url_for(item_type),
        blog_categories=BLOG_CATEGORIES,
        recipe_types=RECIPE_TYPES,
        book_statuses=BOOK_STATUSES,
    )


@app.route("/upload-image", methods=["POST"])
def upload_image():
    saved_images = []
    for file in request.files.getlist("images"):
        saved_name = save_uploaded_image(file)
        if saved_name:
            saved_images.append(
                {
                    "filename": saved_name,
                    "url": url_for("image_file", filename=saved_name),
                }
            )
    return jsonify({"images": saved_images})


@app.route("/img/<path:filename>")
def image_file(filename):
    return send_from_directory("img", filename)


@app.route("/fonts/<path:filename>")
def font_file(filename):
    return send_from_directory("fonts", filename)


if __name__ == "__main__":
    app.run(debug=True)
