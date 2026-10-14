const categories = [
  { value: "Todo", label: "Todo" },
  { value: "Calzado", label: "Calzado" },
  { value: "Indumentaria masculina", label: "Hombre" },
  { value: "Indumentaria femenina", label: "Mujer" },
  { value: "Carteras", label: "Carteras" },
  { value: "iPhone", label: "iPhone" },
  { value: "Cases exclusivos", label: "Cases" },
  { value: "Lentes de sol", label: "Lentes de sol" },
  { value: "Relojes originales", label: "Relojes" },
  { value: "Perfumes", label: "Perfumes" }
];
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
const config = window.URBANEROS_CONFIG || {};
const BUCKET = "catalogo";
let supabaseClient = null;
let products = [];
let activeCategory = "Todo";
let onlySaved = false;
let saved = new Set();
let activeProductPhotos = [];
let currentAdmin = false;

const safe = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const photosOf = product => (Array.isArray(product.photos) ? product.photos : []).filter(Boolean).slice(0, 3);
const fallbackImage = product => product.image ? `https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=900&q=82` : "";
const mainPhoto = product => photosOf(product)[0] || fallbackImage(product);
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
function render() {
  const query = search.value.trim().toLocaleLowerCase("es");
  const shown = products.filter(product =>
    (activeCategory === "Todo" || product.category === activeCategory) &&
    (!onlySaved || saved.has(String(product.id))) &&
    (!query || `${product.category} ${product.name} ${product.detail}`.toLocaleLowerCase("es").includes(query))
  );
  grid.innerHTML = shown.map(product => {
    const photoCount = photosOf(product).length;
    const isSaved = saved.has(String(product.id));
    return `<article class="product-card">
      <div class="product-image-wrap">
        <img src="${safe(mainPhoto(product))}" alt="${safe(product.name)}" loading="lazy" />
        <span class="image-category">${safe(product.category)}</span>
        <button class="favorite-button" data-save="${safe(product.id)}" aria-label="${isSaved ? "Quitar de favoritos" : "Guardar en favoritos"}" aria-pressed="${isSaved}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg></button>
        ${photoCount > 1 ? `<span class="photo-count">${photoCount} fotos</span>` : ""}
        <button class="quick-view" data-view="${safe(product.id)}">Ver producto <span>↗</span></button>
      </div>
      <div class="product-price">${safe(product.price || "Consultar precio")}</div>
      <div class="product-info"><div><h3>${safe(product.name)}</h3><p>${safe(product.category)} · ${safe(product.detail)}</p></div></div>
    </article>`;
  }).join("");
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
}
function openProduct(product) {
  activeProductPhotos = photosOf(product);
  if (!activeProductPhotos.length && fallbackImage(product)) activeProductPhotos = [fallbackImage(product)];
  const image = document.querySelector("#dialog-image");
  image.src = activeProductPhotos[0] || "";
  image.alt = product.name;
  document.querySelector("#dialog-category").textContent = product.category;
  document.querySelector("#dialog-title").textContent = product.name;
  document.querySelector("#dialog-price").textContent = product.price || "Consultar precio";
  const thumbnails = document.querySelector("#product-thumbnails");
  thumbnails.innerHTML = activeProductPhotos.map((photo, index) => `<button class="product-thumbnail ${index === 0 ? "active" : ""}" type="button" data-gallery-index="${index}" aria-label="Ver foto ${index + 1}"><img src="${safe(photo)}" alt="" /></button>`).join("");
  thumbnails.hidden = activeProductPhotos.length < 2;
  document.querySelector("#message-text").value = `Hola, quiero consultar por ${product.name}. ¿Me cuentan el precio y la disponibilidad?`;
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
  const { data, error } = await supabaseClient.from("products").select("id, category, name, detail, price, photos").order("created_at", { ascending: false });
  if (error) {
    products = [];
    document.querySelector("#empty-state h3").textContent = "No pudimos cargar el catálogo";
    document.querySelector("#empty-state p").textContent = "Revisá la conexión e intentá de nuevo más tarde.";
    render();
    return;
  }
  products = data || [];
  render();
}
function renderAdminList() {
  const holder = document.querySelector("#admin-product-list");
  if (!currentAdmin) return;
  holder.innerHTML = products.length ? products.map(product => `<div class="admin-product-row"><div class="admin-product-thumb">${photosOf(product)[0] ? `<img src="${safe(photosOf(product)[0])}" alt="" />` : ""}</div><div class="admin-product-description"><strong>${safe(product.name)}</strong><span>${safe(product.category)} · ${safe(product.price || "Sin precio")}</span></div><button type="button" data-edit-product="${safe(product.id)}">Editar</button><button type="button" class="admin-delete" data-delete-product="${safe(product.id)}">Quitar</button></div>`).join("") : `<p class="admin-empty">Aún no agregaste productos.</p>`;
}
function resetProductForm() {
  productForm.reset();
  productForm.elements.id.value = "";
  document.querySelector("#product-form-title").textContent = "Agregar producto";
  document.querySelector("#save-product").textContent = "Guardar producto";
  document.querySelector("#cancel-edit").hidden = true;
  setStatus(document.querySelector("#product-status"), "");
}
function editProduct(product) {
  productForm.elements.id.value = product.id;
  productForm.elements.name.value = product.name || "";
  productForm.elements.category.value = product.category || "";
  productForm.elements.detail.value = product.detail || "";
  productForm.elements.price.value = product.price || "";
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
grid.addEventListener("click", event => {
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
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
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
  button.disabled = true;
  setStatus(status, "Guardando producto…");
  try {
    const id = productForm.elements.id.value || null;
    const previous = id ? products.find(product => String(product.id) === id) : null;
    const photos = files.length ? await uploadPhotos(files) : photosOf(previous || {});
    if (!photos.length) throw new Error("Elige al menos una foto para el producto.");
    const record = {
      ...(id ? { id } : {}),
      category: productForm.elements.category.value,
      name: productForm.elements.name.value.trim(),
      detail: productForm.elements.detail.value.trim(),
      price: productForm.elements.price.value.trim(),
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

async function start() {
  loadSaved();
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
  await loadProducts();
  if (location.hash === "#admin" || currentAdmin) showAdminPanel();
}
start();
