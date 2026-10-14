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
const cardPhotoIndices = new Map();
let currentAdmin = false;
let featuredFieldsReady = true;
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
  productForm.elements.is_featured.disabled = !featuredFieldsReady;
  productForm.elements.compare_at_price.disabled = !featuredFieldsReady;
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
    const hasDiscount = Boolean(product.is_featured && product.compare_at_price && product.price);
    return `<article class="product-card" data-product-id="${safe(product.id)}">
      <div class="product-image-wrap">
        <div class="card-photo-scroller">${cardPhotos.map((photo, index) => `<img src="${safe(photo)}" alt="${safe(product.name)}${photoCount > 1 ? `, foto ${index + 1} de ${photoCount}` : ""}" loading="lazy" draggable="false" />`).join("")}</div>
        <span class="image-category">${safe(categoryLabel(product.category))}</span>
        <button class="favorite-button" data-save="${safe(product.id)}" aria-label="${isSaved ? "Quitar de favoritos" : "Guardar en favoritos"}" aria-pressed="${isSaved}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg></button>
        ${photoCount > 1 ? `<button class="card-photo-arrow card-photo-prev" type="button" data-photo-step="-1" data-photo-id="${safe(product.id)}" aria-label="Foto anterior de ${safe(product.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button><button class="card-photo-arrow card-photo-next" type="button" data-photo-step="1" data-photo-id="${safe(product.id)}" aria-label="Foto siguiente de ${safe(product.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button><span class="photo-count">${photoIndex + 1} / ${photoCount}</span>` : ""}
        <button class="quick-view" data-view="${safe(product.id)}">Ver producto</button>
      </div>
      <div class="product-price${hasDiscount ? " product-price-sale" : ""}">${hasDiscount ? `<span class="sale-label">OFERTA</span><del>${safe(product.compare_at_price)}</del><strong>${safe(product.price)}</strong>` : safe(product.price || "Consultar precio")}</div>
      <div class="product-info"><div><h3>${safe(product.name)}</h3><p>${safe(product.category)} · ${safe(product.detail)}</p></div></div>
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
  const product = products.find(item => item.is_featured);
  section.hidden = !product;
  document.querySelector("#featured-product-card").hidden = !product;
  if (!product) return;
  const image = document.querySelector("#featured-image");
  image.src = mainPhoto(product) || "";
  image.alt = product.name || "Producto destacado de Urbaneros";
  document.querySelector("#featured-category").textContent = product.category || "";
  document.querySelector("#featured-name").textContent = product.name || "";
  document.querySelector("#featured-detail").textContent = product.detail || "";
  document.querySelector("#featured-old-price").textContent = product.compare_at_price || "";
  document.querySelector("#featured-price").textContent = product.price || "Consultar precio";
  document.querySelector("#featured-product-card").setAttribute("aria-label", `Ver ${product.name} y consultar`);
}
function openProduct(product) {
  activeProductPhotos = photosOf(product);
  if (!activeProductPhotos.length && fallbackImage(product)) activeProductPhotos = [fallbackImage(product)];
  const image = document.querySelector("#dialog-image");
  image.src = activeProductPhotos[0] || "";
  image.alt = product.name;
  document.querySelector("#dialog-category").textContent = categoryLabel(product.category);
  document.querySelector("#dialog-title").textContent = product.name;
  const dialogPrice = document.querySelector("#dialog-price");
  const hasDiscount = Boolean(product.is_featured && product.compare_at_price && product.price);
  dialogPrice.classList.toggle("dialog-price-sale", hasDiscount);
  dialogPrice.innerHTML = hasDiscount ? `<span>OFERTA</span><del>${safe(product.compare_at_price)}</del><strong>${safe(product.price)}</strong>` : safe(product.price || "Consultar precio");
  const thumbnails = document.querySelector("#product-thumbnails");
  thumbnails.innerHTML = activeProductPhotos.map((photo, index) => `<button class="product-thumbnail ${index === 0 ? "active" : ""}" type="button" data-gallery-index="${index}" aria-label="Ver foto ${index + 1}"><img src="${safe(photo)}" alt="" /></button>`).join("");
  thumbnails.hidden = activeProductPhotos.length < 2;
  document.querySelector("#message-text").value = `Hola, quiero consultar por ${product.name}. ¿Cuentan con stock disponible? Gracias.`;
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
  let { data, error } = await supabaseClient.from("products").select("id, category, name, detail, price, photos, is_featured, compare_at_price").order("created_at", { ascending: false });
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
  holder.innerHTML = products.length ? products.map(product => `<div class="admin-product-row"><div class="admin-product-thumb">${photosOf(product)[0] ? `<img src="${safe(photosOf(product)[0])}" alt="" />` : ""}</div><div class="admin-product-description"><strong>${safe(product.name)}</strong><span>${safe(categoryLabel(product.category))} · ${safe(product.price || "Sin precio")}${product.is_featured ? " · Destacado semanal" : ""}</span></div><button type="button" data-edit-product="${safe(product.id)}">Editar</button><button type="button" class="admin-delete" data-delete-product="${safe(product.id)}">Quitar</button></div>`).join("") : `<p class="admin-empty">Aún no agregaste productos.</p>`;
}
function resetProductForm() {
  productForm.reset();
  productForm.elements.id.value = "";
  document.querySelector("#product-form-title").textContent = "Agregar producto";
  document.querySelector("#save-product").textContent = "Guardar producto";
  document.querySelector("#cancel-edit").hidden = true;
  productForm.elements.is_featured.checked = false;
  productForm.elements.compare_at_price.value = "";
  setStatus(document.querySelector("#product-status"), "");
}
function editProduct(product) {
  productForm.elements.id.value = product.id;
  productForm.elements.name.value = product.name || "";
  productForm.elements.category.value = product.category || "";
  productForm.elements.detail.value = product.detail || "";
  productForm.elements.currency.value = priceCurrency(product.price || product.compare_at_price);
  productForm.elements.price.value = priceAmount(product.price);
  productForm.elements.is_featured.checked = Boolean(product.is_featured);
  productForm.elements.compare_at_price.value = priceAmount(product.compare_at_price);
  productForm.elements.photos.value = "";
  document.querySelector("#product-form-title").textContent = "Editar producto";
  document.querySelector("#save-product").textContent = "Guardar cambios";
  document.querySelector("#cancel-edit").hidden = false;
  document.querySelector("#product-form-title").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function uploadPhotos(files) {
  const urls = [];
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
const featuredCard = document.querySelector("#featured-product-card");
function openFeaturedProduct() {
  const product = products.find(item => item.is_featured);
  if (product) openProduct(product);
}
featuredCard.addEventListener("click", openFeaturedProduct);
featuredCard.addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openFeaturedProduct();
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
document.querySelector("#admin-logout").addEventListener("click", async () => { await supabaseClient.auth.signOut(); currentAdmin = false; document.querySelector("#admin-entry").hidden = true; closeAdminPanel(); });
document.querySelector("#cancel-edit").addEventListener("click", resetProductForm);

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
  const files = [...productForm.elements.photos.files];
  if (files.length > 3) return setStatus(status, "Puedes elegir como máximo 3 fotos.", true);
  const currency = productForm.elements.currency.value;
  const price = formatPrice(productForm.elements.price.value, currency);
  const compareAtPrice = formatPrice(productForm.elements.compare_at_price.value, currency);
  if (price === null || compareAtPrice === null) return setStatus(status, "Escribe solo números; usa punto para miles y coma para centavos. Ejemplo: 1.990", true);
  if (productForm.elements.is_featured.checked && (!price || !compareAtPrice)) return setStatus(status, "Para el producto semanal, completa el precio de oferta y el precio anterior.", true);
  button.disabled = true;
  setStatus(status, "Guardando producto…");
  try {
    const id = productForm.elements.id.value || null;
    const previous = id ? products.find(product => String(product.id) === id) : null;
    const photos = files.length ? await uploadPhotos(files) : photosOf(previous || {});
    if (!photos.length) throw new Error("Elige al menos una foto para el producto.");
    if (productForm.elements.is_featured.checked) {
      const { error: clearFeaturedError } = await supabaseClient.from("products").update({ is_featured: false }).eq("is_featured", true).neq("id", id || "00000000-0000-0000-0000-000000000000");
      if (clearFeaturedError) throw clearFeaturedError;
    }
    const record = {
      ...(id ? { id } : {}),
      category: productForm.elements.category.value,
      name: productForm.elements.name.value.trim(),
      detail: productForm.elements.detail.value.trim(),
      price,
      is_featured: productForm.elements.is_featured.checked,
      compare_at_price: productForm.elements.is_featured.checked ? compareAtPrice : "",
      photos
    };
    const { error } = await supabaseClient.from("products").upsert(record).select().single();
    if (error) throw error;
    if (files.length && previous) {
      const oldPaths = photosOf(previous).map(storagePathFromUrl).filter(Boolean);
      if (oldPaths.length) await supabaseClient.storage.from(BUCKET).remove(oldPaths);
    }
    resetProductForm();
    setStatus(status, "Producto guardado. Ya aparece en el catálogo.");
    await loadProducts();
    renderAdminList();
  } catch (error) {
    setStatus(status, error.message || "No pudimos guardar el producto. Revisa la conexión.", true);
  } finally { button.disabled = false; }
});

document.querySelector("#admin-product-list").addEventListener("click", async event => {
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
