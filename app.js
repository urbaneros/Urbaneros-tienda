const defaultCategories = [
  { value: "Todo", label: "Todo" },
  { value: "Calzado", label: "Calzado" },
  { value: "Indumentaria masculina", label: "Hombre" },
  { value: "Indumentaria femenina", label: "Mujer" },
  { value: "Carteras", label: "Carteras" },
  { value: "iPhone", label: "Apple" },
  { value: "Cases exclusivos", label: "Cases" },
  { value: "Lentes de sol", label: "Lentes de sol" },
  { value: "Relojes originales", label: "Relojes" },
  { value: "Perfumes", label: "Perfumes" }
];
let categories = defaultCategories.map(category => ({ ...category }));
const grid = document.querySelector("#product-grid");
const filters = document.querySelector("#filters");
const search = document.querySelector("#search");
const count = document.querySelector("#result-count");
const empty = document.querySelector("#empty-state");
const dialog = document.querySelector("#product-dialog");
const adminPanel = document.querySelector("#admin-panel");
const adminBackdrop = document.querySelector("#admin-backdrop");
const loginForm = document.querySelector("#login-form");
const productForm = document.querySelector("#product-form");
const categoryForm = document.querySelector("#category-form");
const config = window.URBANEROS_CONFIG || {};
const BUCKET = "catalogo";
let supabaseClient = null;
let products = [];
let activeCategory = "Todo";
let onlySaved = false;
let saved = new Set();
let activeProductPhotos = [];
let photoDraft = [];
let savingProduct = false;
const cardPhotoIndices = new Map();
let featuredIndex = 0;
let currentAdmin = false;
let featuredFieldsReady = true;
let soldOutFieldReady = true;
let categoriesTableReady = false;

const safe = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const priceAmount = value => String(value || "").match(/\d[\d.,]*/)?.[0] || "";
const priceCurrency = value => /US\s*\$|USD|d[oó]lar/i.test(String(value || "")) ? "US$" : "$";
function formatPrice(value, currency) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const amount = raw.replace(/\./g, "");
  if (!/^\d+(?:,\d{1,2})?$/.test(amount)) return null;
  const [whole, cents] = amount.split(",");
  const grouped = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${currency}${grouped}${cents ? `,${cents}` : ""}`;
}
function displayPrice(value) {
  const original = String(value || "").trim();
  if (!original) return "";
  const amount = priceAmount(original);
  return amount ? formatPrice(amount, priceCurrency(original)) || original : original;
}
const photosOf = product => (Array.isArray(product.photos) ? product.photos : []).filter(Boolean).slice(0, 3);
const fallbackImage = product => product.image ? `https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=900&q=82` : "";
const mainPhoto = product => photosOf(product)[0] || fallbackImage(product);
const categoryLabel = value => categories.find(category => category.value === String(value))?.label || value;
const isConfigured = () => Boolean(config.url && config.publishableKey && window.supabase?.createClient);
async function verifyAdmin() {
  if (!supabaseClient) return false;
  const { data, error } = await supabaseClient.rpc("is_urbaneros_admin");
  return !error && data === true;
}

function loadSaved() {
  try { saved = new Set(JSON.parse(localStorage.getItem("urbaneros-favoritos") || "[]")); }
  catch { saved = new Set(); }
}
function renderFilters() {
  filters.innerHTML = categories.map(category => `<button class="filter-button ${activeCategory === category.value ? "active" : ""}" data-filter="${safe(category.value)}" aria-pressed="${activeCategory === category.value}">${safe(category.label)}</button>`).join("");
}
function renderCategoryChoices() {
  const links = document.querySelector("#category-links");
  links.innerHTML = categories.filter(category => category.value !== "Todo").map(category => `<button data-category="${safe(category.value)}">${safe(category.label)}</button>`).join("");
  const select = productForm.elements.category;
  const selected = select.value;
  select.innerHTML = `<option value="">Elegir categoría</option>${categories.filter(category => category.value !== "Todo").map(category => `<option value="${safe(category.value)}">${safe(category.label)}</option>`).join("")}`;
  select.value = selected;
  document.querySelector("#category-list").innerHTML = categories.filter(category => category.value !== "Todo").map(category => `<div class="category-list-item"><span class="category-chip">${safe(category.label)}</span><button class="category-edit" type="button" data-edit-category="${safe(category.value)}"${categoriesTableReady ? "" : " disabled"}>Editar</button></div>`).join("");
}
function updateAdminSchemaAccess() {
  document.querySelector("#featured-migration-warning").hidden = (featuredFieldsReady && categoriesTableReady) || !currentAdmin;
  document.querySelector("#stock-migration-warning").hidden = soldOutFieldReady || !currentAdmin;
  productForm.elements.is_featured.disabled = !featuredFieldsReady;
  productForm.elements.compare_at_price.disabled = !featuredFieldsReady;
  productForm.elements.is_sold_out.disabled = !soldOutFieldReady;
  document.querySelector("#category-name").disabled = !categoriesTableReady;
  document.querySelector("#add-category").disabled = !categoriesTableReady;
}
function render() {
  const query = search.value.trim().toLocaleLowerCase("es");
  const shown = products.filter(product =>
    (activeCategory === "Todo" || product.category === activeCategory) &&
    (!onlySaved || saved.has(String(product.id))) &&
    (!query || `${categoryLabel(product.category)} ${product.name} ${product.detail}`.toLocaleLowerCase("es").includes(query))
  );
  grid.innerHTML = shown.map(product => {
    const photoCount = photosOf(product).length;
    const productId = String(product.id);
    const photoIndex = Math.min(cardPhotoIndices.get(productId) || 0, Math.max(0, photoCount - 1));
    const cardPhotos = photoCount ? photosOf(product) : [mainPhoto(product)];
    const isSaved = saved.has(String(product.id));
    const hasDiscount = Boolean(product.compare_at_price && product.price);
    const isSoldOut = product.is_sold_out === true;
    return `<article class="product-card${isSoldOut ? " is-sold-out" : ""}" data-product-id="${safe(product.id)}">
      <div class="product-image-wrap">
        <div class="card-photo-scroller">${cardPhotos.map((photo, index) => `<img src="${safe(photo)}" alt="${safe(product.name)}${photoCount > 1 ? `, foto ${index + 1} de ${photoCount}` : ""}" loading="lazy" draggable="false" />`).join("")}</div>
        ${isSoldOut ? '<span class="sold-out-badge">AGOTADO</span>' : `<span class="image-category">${safe(categoryLabel(product.category))}</span>`}
        <button class="favorite-button" data-save="${safe(product.id)}" aria-label="${isSaved ? "Quitar de favoritos" : "Guardar en favoritos"}" aria-pressed="${isSaved}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg></button>
        ${photoCount > 1 ? `<button class="card-photo-arrow card-photo-prev" type="button" data-photo-step="-1" data-photo-id="${safe(product.id)}" aria-label="Foto anterior de ${safe(product.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button><button class="card-photo-arrow card-photo-next" type="button" data-photo-step="1" data-photo-id="${safe(product.id)}" aria-label="Foto siguiente de ${safe(product.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button><span class="photo-count">${photoIndex + 1} / ${photoCount}</span>` : ""}
        <button class="quick-view" data-view="${safe(product.id)}">Ver producto</button>
      </div>
      <div class="product-price${hasDiscount ? " product-price-sale" : ""}">${hasDiscount ? `<span class="sale-label">OFERTA</span><del>${safe(product.compare_at_price)}</del><strong>${safe(product.price)}</strong>` : safe(product.price || "Consultar precio")}</div>
      <div class="product-info"><div><h3>${safe(product.name)}</h3><p><span class="product-card-category">${safe(categoryLabel(product.category))}</span><span class="product-card-separator"> · </span><span class="product-card-description">${safe(product.detail)}</span></p></div></div>
    </article>`;
  }).join("");
  grid.querySelectorAll(".card-photo-scroller").forEach(scroller => {
    const card = scroller.closest(".product-card");
    const index = cardPhotoIndices.get(card.dataset.productId) || 0;
    if (index) scroller.scrollLeft = index * scroller.clientWidth;
    scroller.addEventListener("scroll", () => {
      const count = scroller.children.length;
      if (count < 2 || !scroller.clientWidth) return;
      const visible = Math.max(0, Math.min(count - 1, Math.round(scroller.scrollLeft / scroller.clientWidth)));
      cardPhotoIndices.set(card.dataset.productId, visible);
      card.querySelector(".photo-count").textContent = `${visible + 1} / ${count}`;
    }, { passive: true });
  });
  count.textContent = `${shown.length} ${shown.length === 1 ? "producto" : "productos"}`;
  empty.hidden = shown.length !== 0;
  grid.hidden = shown.length === 0;
  if (!products.length) {
    document.querySelector("#empty-state h3").textContent = "Estamos preparando la selección";
    document.querySelector("#empty-state p").textContent = "Pronto vas a encontrar aquí los productos de Urbaneros.";
    document.querySelector("#show-all").hidden = true;
  } else {
    document.querySelector("#empty-state h3").textContent = "No encontramos esa selección";
    document.querySelector("#empty-state p").textContent = "Probá con otra búsqueda o elegí una categoría diferente.";
    document.querySelector("#show-all").hidden = false;
  }
  document.querySelector("#clear-filters").hidden = activeCategory === "Todo" && !onlySaved && !query;
  document.querySelector("#saved-count").textContent = saved.size;
  document.querySelectorAll(".main-nav a").forEach(link => link.classList.toggle("active", link.dataset.navCategory === activeCategory));
  renderFeaturedProduct();
}
function renderFeaturedProduct() {
  const section = document.querySelector("#destacado");
  const featured = products.filter(item => item.is_featured);
  section.hidden = featured.length === 0;
  const track = document.querySelector("#featured-track");
  const controls = document.querySelector("#featured-controls");
  track.innerHTML = featured.map(product => {
    const hasDiscount = Boolean(product.compare_at_price && product.price);
    const isSoldOut = product.is_sold_out === true;
    return `<article class="featured-product${isSoldOut ? " is-sold-out" : ""}" role="button" tabindex="0" data-featured-id="${safe(product.id)}" aria-label="Ver ${safe(product.name)}${isSoldOut ? ", agotado" : " y consultar"}">
      <div class="featured-photo"><img src="${safe(mainPhoto(product))}" alt="${safe(product.name)}" loading="lazy" />${isSoldOut ? '<span class="sold-out-badge">AGOTADO</span>' : ""}</div>
      <div class="featured-copy"><p class="featured-category">${safe(categoryLabel(product.category))}</p><h3>${safe(product.name)}</h3><p>${safe(product.detail)}</p><div class="featured-prices">${hasDiscount ? `<span class="featured-sale-label">OFERTA</span><del>${safe(product.compare_at_price)}</del>` : ""}<strong>${safe(product.price || "Consultar precio")}</strong></div><span class="featured-cta">Ver producto y consultar <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h11m-4-4 4 4-4 4" /></svg></span></div>
    </article>`;
  }).join("");
  controls.hidden = featured.length < 2;
  document.querySelector("#featured-heading-title").innerHTML = `${featured.length === 1 ? "Destacado" : "Destacados"} de la<br /><em>semana</em>`;
  if (!featured.length) { featuredIndex = 0; return; }
  featuredIndex = Math.min(featuredIndex, featured.length - 1);
  document.querySelector("#featured-position").textContent = `${featuredIndex + 1} / ${featured.length}`;
  if (featuredIndex) track.scrollLeft = featuredIndex * track.clientWidth;
}
function openProduct(product) {
  activeProductPhotos = photosOf(product);
  if (!activeProductPhotos.length && fallbackImage(product)) activeProductPhotos = [fallbackImage(product)];
  const image = document.querySelector("#dialog-image");
  image.src = activeProductPhotos[0] || "";
  image.alt = product.name;
  const isSoldOut = product.is_sold_out === true;
  image.classList.toggle("sold-out-image", isSoldOut);
  document.querySelector("#dialog-stock-status").hidden = !isSoldOut;
  document.querySelector("#dialog-category").textContent = categoryLabel(product.category);
  document.querySelector("#dialog-title").textContent = product.name;
  const description = document.querySelector("#dialog-product-description");
  description.textContent = product.detail || "";
  description.hidden = !product.detail;
  const dialogPrice = document.querySelector("#dialog-price");
  const hasDiscount = Boolean(product.compare_at_price && product.price);
  dialogPrice.classList.toggle("dialog-price-sale", hasDiscount);
  dialogPrice.innerHTML = hasDiscount ? `<span>OFERTA</span><del>${safe(product.compare_at_price)}</del><strong>${safe(product.price)}</strong>` : safe(product.price || "Consultar precio");
  const thumbnails = document.querySelector("#product-thumbnails");
  thumbnails.innerHTML = activeProductPhotos.map((photo, index) => `<button class="product-thumbnail ${index === 0 ? "active" : ""}" type="button" data-gallery-index="${index}" aria-label="Ver foto ${index + 1}"><img src="${safe(photo)}" alt="" /></button>`).join("");
  thumbnails.hidden = activeProductPhotos.length < 2;
  document.querySelector("#dialog-description").textContent = isSoldOut ? "Este producto está agotado. Consultanos por su reposición." : "Consultá disponibilidad de este producto.";
  document.querySelector("#message-text").value = isSoldOut ? `Hola, quiero consultar cuándo vuelve a estar disponible ${product.name}. Gracias.` : `Hola, quiero consultar por ${product.name}. ¿Cuentan con stock disponible? Gracias.`;
  dialog.showModal();
}
function showAdminPanel() {
  adminPanel.hidden = false;
  adminBackdrop.hidden = false;
  document.body.classList.add("admin-open");
  document.querySelector("#admin-login").hidden = currentAdmin;
  document.querySelector("#admin-workspace").hidden = !currentAdmin;
  document.querySelector("#admin-entry").hidden = !currentAdmin;
  if (currentAdmin) renderAdminList();
}
function closeAdminPanel() {
  adminPanel.hidden = true;
  adminBackdrop.hidden = true;
  document.body.classList.remove("admin-open");
  if (location.hash === "#admin") history.replaceState(null, "", location.pathname + location.search);
}
function setStatus(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle("error", isError);
}
async function loadProducts() {
  if (!supabaseClient) {
    products = [];
    render();
    return;
  }
  let { data, error } = await supabaseClient.from("products").select("id, category, name, detail, price, photos, is_featured, compare_at_price, is_sold_out").order("created_at", { ascending: false });
  soldOutFieldReady = !error;
  if (error) ({ data, error } = await supabaseClient.from("products").select("id, category, name, detail, price, photos, is_featured, compare_at_price").order("created_at", { ascending: false }));
  featuredFieldsReady = !error;
  if (error) ({ data, error } = await supabaseClient.from("products").select("id, category, name, detail, price, photos").order("created_at", { ascending: false }));
  updateAdminSchemaAccess();
  if (error) {
    products = [];
    document.querySelector("#empty-state h3").textContent = "No pudimos cargar el catálogo";
    document.querySelector("#empty-state p").textContent = "Revisá la conexión e intentá de nuevo más tarde.";
    render();
    return;
  }
  products = (data || []).map(product => ({
    ...product,
    price: displayPrice(product.price),
    compare_at_price: displayPrice(product.compare_at_price)
  }));
  render();
}
async function loadCategories() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient.from("categories").select("value, label, sort_order").order("sort_order", { ascending: true }).order("label", { ascending: true });
  categoriesTableReady = !error;
  if (categoriesTableReady) categories = [{ value: "Todo", label: "Todo" }, ...(data || []).map(category => ({ ...category }))];
  else categories = defaultCategories.map(category => ({ ...category }));
  renderCategoryChoices();
  renderFilters();
  updateAdminSchemaAccess();
}
function renderAdminList() {
  const holder = document.querySelector("#admin-product-list");
  if (!currentAdmin) return;
  holder.innerHTML = products.length ? products.map(product => `<div class="admin-product-row"><div class="admin-product-thumb">${photosOf(product)[0] ? `<img src="${safe(photosOf(product)[0])}" alt="" />` : ""}</div><div class="admin-product-description"><strong>${safe(product.name)}</strong><span>${safe(categoryLabel(product.category))} · ${safe(product.price || "Sin precio")}${product.is_sold_out ? " · AGOTADO" : ""}${product.compare_at_price && product.price ? " · Oferta" : ""}${product.is_featured ? " · Destacado semanal" : ""}</span></div><button type="button" data-edit-product="${safe(product.id)}">Editar</button><button type="button" class="admin-delete" data-delete-product="${safe(product.id)}">Quitar</button></div>`).join("") : `<p class="admin-empty">Aún no agregaste productos.</p>`;
}
function renderPhotoDraft() {
  const holder = document.querySelector("#photo-order-preview");
  holder.innerHTML = photoDraft.map((photo, index) => `<div class="photo-order-item">
    <div class="photo-order-image"><img src="${safe(photo.kind === "new" ? photo.previewUrl : photo.url)}" alt="Vista previa de la foto ${index + 1}" /><span>${index + 1}${index === 0 ? " · Principal" : ""}</span></div>
    <div class="photo-order-actions"><button type="button" data-photo-move="-1" data-photo-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="Mover foto ${index + 1} hacia la izquierda">Izquierda</button><button type="button" data-photo-move="1" data-photo-index="${index}" ${index === photoDraft.length - 1 ? "disabled" : ""} aria-label="Mover foto ${index + 1} hacia la derecha">Derecha</button><button type="button" class="photo-order-remove" data-photo-remove="${index}" aria-label="Quitar foto ${index + 1}">Quitar</button></div>
  </div>`).join("");
}
function clearPhotoDraft() {
  photoDraft.forEach(photo => { if (photo.kind === "new") URL.revokeObjectURL(photo.previewUrl); });
  photoDraft = [];
  renderPhotoDraft();
}
function resetProductForm() {
  productForm.reset();
  clearPhotoDraft();
  productForm.elements.id.value = "";
  document.querySelector("#product-form-title").textContent = "Agregar producto";
  document.querySelector("#save-product").textContent = "Guardar producto";
  document.querySelector("#cancel-edit").hidden = true;
  productForm.elements.is_featured.checked = false;
  productForm.elements.is_sold_out.checked = false;
  productForm.elements.compare_at_price.value = "";
  setStatus(document.querySelector("#product-status"), "");
}
function editProduct(product) {
  if (savingProduct) return;
  clearPhotoDraft();
  photoDraft = photosOf(product).map(url => ({ kind: "stored", url }));
  renderPhotoDraft();
  productForm.elements.id.value = product.id;
  productForm.elements.name.value = product.name || "";
  productForm.elements.category.value = product.category || "";
  productForm.elements.detail.value = product.detail || "";
  productForm.elements.currency.value = priceCurrency(product.price || product.compare_at_price);
  productForm.elements.price.value = priceAmount(product.price);
  productForm.elements.is_featured.checked = Boolean(product.is_featured);
  productForm.elements.is_sold_out.checked = product.is_sold_out === true;
  productForm.elements.compare_at_price.value = priceAmount(product.compare_at_price);
  productForm.elements.photos.value = "";
  document.querySelector("#product-form-title").textContent = "Editar producto";
  document.querySelector("#save-product").textContent = "Guardar cambios";
  document.querySelector("#cancel-edit").hidden = false;
  document.querySelector("#product-form-title").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function uploadPhotos(files, urls = []) {
  for (const file of files) {
    const cleanName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100) || "foto.jpg";
    const path = `${crypto.randomUUID()}-${cleanName}`;
    const { error } = await supabaseClient.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
    if (error) throw error;
    urls.push(supabaseClient.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
  }
  return urls;
}
function storagePathFromUrl(url) {
  try {
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const index = new URL(url).pathname.indexOf(marker);
    return index >= 0 ? decodeURIComponent(new URL(url).pathname.slice(index + marker.length)) : null;
  } catch { return null; }
}

filters.addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  activeCategory = button.dataset.filter;
  onlySaved = false;
  renderFilters(); render();
});
document.querySelector(".category-links").addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category; onlySaved = false; renderFilters(); render();
  document.querySelector("#catalogo").scrollIntoView({ behavior: "smooth" });
});
document.querySelector(".main-nav").addEventListener("click", event => {
  const link = event.target.closest("[data-nav-category]");
  if (!link) return;
  activeCategory = link.dataset.navCategory; onlySaved = false; renderFilters(); render();
  document.querySelector("#main-nav").classList.remove("open");
  document.querySelector("#menu-toggle").setAttribute("aria-expanded", "false");
});
function changeCardPhoto(card, step) {
  const product = products.find(item => String(item.id) === card?.dataset.productId);
  const photos = product && photosOf(product);
  if (!photos || photos.length < 2) return;
  const id = String(product.id);
  const index = ((cardPhotoIndices.get(id) || 0) + step + photos.length) % photos.length;
  cardPhotoIndices.set(id, index);
  const scroller = card.querySelector(".card-photo-scroller");
  scroller.scrollTo({ left: index * scroller.clientWidth, behavior: "smooth" });
  card.querySelector(".photo-count").textContent = `${index + 1} / ${photos.length}`;
}
grid.addEventListener("click", event => {
  const photoButton = event.target.closest("[data-photo-step]");
  if (photoButton) {
    changeCardPhoto(photoButton.closest(".product-card"), Number(photoButton.dataset.photoStep));
    return;
  }
  const saveButton = event.target.closest("[data-save]");
  if (saveButton) {
    const id = saveButton.dataset.save;
    saved.has(id) ? saved.delete(id) : saved.add(id);
    localStorage.setItem("urbaneros-favoritos", JSON.stringify([...saved])); render(); return;
  }
  const viewButton = event.target.closest("[data-view]");
  const product = products.find(item => String(item.id) === viewButton?.dataset.view);
  if (product) openProduct(product);
});
const featuredTrack = document.querySelector("#featured-track");
function moveFeatured(step) {
  const total = featuredTrack.children.length;
  if (total < 2) return;
  featuredIndex = (featuredIndex + step + total) % total;
  featuredTrack.scrollTo({ left: featuredIndex * featuredTrack.clientWidth, behavior: "smooth" });
  document.querySelector("#featured-position").textContent = `${featuredIndex + 1} / ${total}`;
}
document.querySelector("#featured-prev").addEventListener("click", () => moveFeatured(-1));
document.querySelector("#featured-next").addEventListener("click", () => moveFeatured(1));
featuredTrack.addEventListener("scroll", () => {
  if (!featuredTrack.clientWidth || !featuredTrack.children.length) return;
  featuredIndex = Math.max(0, Math.min(featuredTrack.children.length - 1, Math.round(featuredTrack.scrollLeft / featuredTrack.clientWidth)));
  document.querySelector("#featured-position").textContent = `${featuredIndex + 1} / ${featuredTrack.children.length}`;
}, { passive: true });
let featuredTouchStart = null;
let featuredSwipeMoved = false;
featuredTrack.addEventListener("touchstart", event => {
  if (event.touches.length !== 1) return;
  featuredTouchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  featuredSwipeMoved = false;
}, { passive: true });
featuredTrack.addEventListener("touchmove", event => {
  if (!featuredTouchStart || !event.touches.length) return;
  const dx = event.touches[0].clientX - featuredTouchStart.x;
  const dy = event.touches[0].clientY - featuredTouchStart.y;
  if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) featuredSwipeMoved = true;
}, { passive: true });
featuredTrack.addEventListener("touchend", () => {
  featuredTouchStart = null;
  if (featuredSwipeMoved) setTimeout(() => { featuredSwipeMoved = false; }, 350);
}, { passive: true });
featuredTrack.addEventListener("click", event => {
  if (featuredSwipeMoved) { featuredSwipeMoved = false; return; }
  const card = event.target.closest("[data-featured-id]");
  const product = products.find(item => String(item.id) === card?.dataset.featuredId);
  if (product) openProduct(product);
});
featuredTrack.addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-featured-id]");
  if (!card) return;
  event.preventDefault();
  const product = products.find(item => String(item.id) === card.dataset.featuredId);
  if (product) openProduct(product);
});
search.addEventListener("input", render);
document.querySelector("#saved-button").addEventListener("click", () => {
  onlySaved = !onlySaved; activeCategory = "Todo"; renderFilters(); render();
  document.querySelector("#catalogo").scrollIntoView({ behavior: "smooth" });
});
document.querySelector("#clear-filters").addEventListener("click", () => {
  activeCategory = "Todo"; onlySaved = false; search.value = ""; renderFilters(); render();
});
document.querySelector("#show-all").addEventListener("click", () => {
  activeCategory = "Todo"; onlySaved = false; search.value = ""; renderFilters(); render();
});
document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());
document.querySelector("#dialog-return").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener("cancel", () => dialog.close());
document.querySelector("#product-thumbnails").addEventListener("click", event => {
  const button = event.target.closest("[data-gallery-index]");
  if (!button) return;
  const index = Number(button.dataset.galleryIndex);
  document.querySelector("#dialog-image").src = activeProductPhotos[index] || activeProductPhotos[0];
  document.querySelectorAll(".product-thumbnail").forEach((thumb, current) => thumb.classList.toggle("active", current === index));
});
document.querySelector("#menu-toggle").addEventListener("click", event => {
  const button = event.currentTarget;
  const open = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!open));
  document.querySelector("#main-nav").classList.toggle("open", !open);
});
document.querySelector("#copy-message").addEventListener("click", () => {
  const message = encodeURIComponent(document.querySelector("#message-text").value);
  dialog.close();
  window.open("https://wa.me/59894094167?text=" + message, "_blank", "noopener");
});
document.querySelector("#saved-button").setAttribute("aria-label", "Ver favoritos");
document.querySelector("#admin-entry").addEventListener("click", showAdminPanel);
document.querySelector("#admin-close").addEventListener("click", closeAdminPanel);
document.querySelector("#admin-backdrop").addEventListener("click", closeAdminPanel);
window.addEventListener("hashchange", () => { if (location.hash === "#admin") showAdminPanel(); });
document.querySelector("#admin-logout").addEventListener("click", async () => { if (savingProduct) return; await supabaseClient.auth.signOut(); currentAdmin = false; resetProductForm(); document.querySelector("#admin-entry").hidden = true; closeAdminPanel(); });
document.querySelector("#cancel-edit").addEventListener("click", resetProductForm);
productForm.elements.photos.addEventListener("change", event => {
  const files = [...event.target.files];
  event.target.value = "";
  if (!files.length) return;
  const status = document.querySelector("#product-status");
  if (photoDraft.length + files.length > 3) return setStatus(status, "Puedes tener como máximo 3 fotos. Quita una de la vista previa antes de agregar otra.", true);
  if (files.some(file => !file.type.startsWith("image/"))) return setStatus(status, "Elige solamente archivos de imagen.", true);
  photoDraft.push(...files.map(file => ({ kind: "new", file, previewUrl: URL.createObjectURL(file) })));
  renderPhotoDraft();
  setStatus(status, "Ordená las fotos como quieras y luego guardá el producto.");
});
document.querySelector("#photo-order-preview").addEventListener("click", event => {
  const moveButton = event.target.closest("[data-photo-move]");
  const removeButton = event.target.closest("[data-photo-remove]");
  if (moveButton) {
    const index = Number(moveButton.dataset.photoIndex);
    const next = index + Number(moveButton.dataset.photoMove);
    if (next < 0 || next >= photoDraft.length) return;
    [photoDraft[index], photoDraft[next]] = [photoDraft[next], photoDraft[index]];
    renderPhotoDraft();
  } else if (removeButton) {
    const index = Number(removeButton.dataset.photoRemove);
    const [removed] = photoDraft.splice(index, 1);
    if (removed?.kind === "new") URL.revokeObjectURL(removed.previewUrl);
    renderPhotoDraft();
  }
});

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabaseClient) return setStatus(document.querySelector("#login-status"), "Falta terminar la conexión de la tienda.", true);
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  setStatus(document.querySelector("#login-status"), "Verificando acceso…");
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email: loginForm.elements.email.value.trim(), password: loginForm.elements.password.value });
  button.disabled = false;
  if (error) return setStatus(document.querySelector("#login-status"), "No pudimos iniciar sesión. Revisa el correo y la contraseña.", true);
  if (!await verifyAdmin()) {
    await supabaseClient.auth.signOut();
    return setStatus(document.querySelector("#login-status"), "Este usuario no está autorizado para administrar Urbaneros.", true);
  }
  currentAdmin = true;
  document.querySelector("#admin-entry").hidden = false;
  loginForm.reset();
  showAdminPanel();
  await loadCategories();
  await loadProducts();
  renderAdminList();
});

productForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentAdmin) return;
  const status = document.querySelector("#product-status");
  const button = document.querySelector("#save-product");
  if (!photoDraft.length || photoDraft.length > 3) return setStatus(status, "El producto necesita entre 1 y 3 fotos.", true);
  const draft = photoDraft.slice();
  const currency = productForm.elements.currency.value;
  const price = formatPrice(productForm.elements.price.value, currency);
  const compareAtPrice = formatPrice(productForm.elements.compare_at_price.value, currency);
  if (price === null || compareAtPrice === null) return setStatus(status, "Escribe solo números; usa punto para miles y coma para centavos. Ejemplo: 1.990", true);
  if (compareAtPrice && !price) return setStatus(status, "Para mostrar una oferta, completá también el precio actual.", true);
  savingProduct = true;
  button.disabled = true;
  productForm.elements.photos.disabled = true;
  document.querySelector("#cancel-edit").disabled = true;
  document.querySelectorAll("#photo-order-preview button").forEach(control => { control.disabled = true; });
  setStatus(status, "Guardando producto…");
  const uploadedUrls = [];
  let savedRecord = false;
  try {
    const id = productForm.elements.id.value || null;
    const previous = id ? products.find(product => String(product.id) === id) : null;
    await uploadPhotos(draft.filter(photo => photo.kind === "new").map(photo => photo.file), uploadedUrls);
    let nextUploaded = 0;
    const photos = draft.map(photo => photo.kind === "stored" ? photo.url : uploadedUrls[nextUploaded++]);
    const record = {
      ...(id ? { id } : {}),
      category: productForm.elements.category.value,
      name: productForm.elements.name.value.trim(),
      detail: productForm.elements.detail.value.trim(),
      price,
      is_featured: productForm.elements.is_featured.checked,
      compare_at_price: compareAtPrice,
      ...(soldOutFieldReady ? { is_sold_out: productForm.elements.is_sold_out.checked } : {}),
      photos
    };
    const { error } = await supabaseClient.from("products").upsert(record).select().single();
    if (error) throw error;
    savedRecord = true;
    if (previous) {
      const oldPaths = photosOf(previous).filter(url => !photos.includes(url)).map(storagePathFromUrl).filter(Boolean);
      if (oldPaths.length) { try { await supabaseClient.storage.from(BUCKET).remove(oldPaths); } catch {} }
    }
    resetProductForm();
    setStatus(status, "Producto guardado. Ya aparece en el catálogo.");
    await loadProducts();
    renderAdminList();
  } catch (error) {
    if (!savedRecord && uploadedUrls.length) {
      const paths = uploadedUrls.map(storagePathFromUrl).filter(Boolean);
      if (paths.length) { try { await supabaseClient.storage.from(BUCKET).remove(paths); } catch {} }
    }
    setStatus(status, error.message || "No pudimos guardar el producto. Revisa la conexión.", true);
  } finally {
    savingProduct = false;
    button.disabled = false;
    productForm.elements.photos.disabled = false;
    document.querySelector("#cancel-edit").disabled = false;
    renderPhotoDraft();
  }
});

document.querySelector("#admin-product-list").addEventListener("click", async event => {
  if (savingProduct) return;
  const editButton = event.target.closest("[data-edit-product]");
  if (editButton) {
    const product = products.find(item => String(item.id) === editButton.dataset.editProduct);
    if (product) editProduct(product);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-product]");
  if (!deleteButton || !currentAdmin) return;
  const product = products.find(item => String(item.id) === deleteButton.dataset.deleteProduct);
  if (!product || !window.confirm(`¿Quitar “${product.name}” del catálogo?`)) return;
  deleteButton.disabled = true;
  const { error } = await supabaseClient.from("products").delete().eq("id", product.id);
  if (error) {
    deleteButton.disabled = false;
    return setStatus(document.querySelector("#product-status"), "No pudimos quitar el producto. Revisa la conexión.", true);
  }
  const paths = photosOf(product).map(storagePathFromUrl).filter(Boolean);
  if (paths.length) await supabaseClient.storage.from(BUCKET).remove(paths);
  await loadProducts();
  renderAdminList();
});

categoryForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentAdmin) return;
  const status = document.querySelector("#category-status");
  const button = document.querySelector("#add-category");
  const name = categoryForm.elements.name.value.trim().replace(/\s+/g, " ");
  if (!categoriesTableReady) return setStatus(status, "Primero hay que actualizar Supabase para agregar categorías.", true);
  if (name.length < 2) return setStatus(status, "Escribe un nombre de al menos 2 caracteres.", true);
  if (categories.some(category => [category.value, category.label].some(value => String(value).toLocaleLowerCase("es") === name.toLocaleLowerCase("es")))) return setStatus(status, "Esa categoría ya existe.", true);
  button.disabled = true;
  setStatus(status, "Guardando categoría…");
  const nextOrder = Math.max(0, ...categories.map(category => Number(category.sort_order) || 0)) + 1;
  const { error } = await supabaseClient.from("categories").insert({ value: name, label: name, sort_order: nextOrder });
  button.disabled = false;
  if (error) return setStatus(status, "No pudimos agregar la categoría. Revisa la conexión y vuelve a intentar.", true);
  categoryForm.reset();
  await loadCategories();
  setStatus(status, `La categoría “${name}” ya está disponible.`);
});

document.querySelector("#category-list").addEventListener("click", async event => {
  const button = event.target.closest("[data-edit-category]");
  if (!button || !currentAdmin || !categoriesTableReady) return;
  const category = categories.find(item => item.value === button.dataset.editCategory);
  if (!category) return;
  const input = window.prompt("Escribe el nuevo nombre de la categoría:", category.label);
  if (input === null) return;
  const name = input.trim().replace(/\s+/g, " ");
  const status = document.querySelector("#category-status");
  if (name.length < 2 || name.length > 50) return setStatus(status, "El nombre debe tener entre 2 y 50 caracteres.", true);
  if (categories.some(item => item.value !== category.value && [item.value, item.label].some(value => String(value).toLocaleLowerCase("es") === name.toLocaleLowerCase("es")))) return setStatus(status, "Ya existe otra categoría con ese nombre.", true);
  button.disabled = true;
  setStatus(status, "Actualizando categoría…");
  const { error } = await supabaseClient.from("categories").update({ label: name }).eq("value", category.value);
  if (error) {
    button.disabled = false;
    return setStatus(status, "No pudimos cambiar el nombre. Revisa la conexión y vuelve a intentar.", true);
  }
  await loadCategories();
  render();
  renderAdminList();
  setStatus(status, `La categoría ahora se llama “${name}”.`);
});

async function start() {
  loadSaved();
  renderCategoryChoices();
  renderFilters();
  if (!isConfigured()) {
    products = [];
    render();
    document.querySelector("#empty-state h3").textContent = "Catálogo en preparación";
    document.querySelector("#empty-state p").textContent = "Urbaneros está preparando su catálogo online.";
    if (location.hash === "#admin") showAdminPanel();
    return;
  }
  supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentAdmin = Boolean(session && await verifyAdmin());
  document.querySelector("#admin-entry").hidden = !currentAdmin;
  await loadCategories();
  await loadProducts();
  if (location.hash === "#admin" || currentAdmin) showAdminPanel();
}
start();
