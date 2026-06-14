const currentPage = document.body.dataset.page;
const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");
const navLinks = [...document.querySelectorAll("[data-page-link]")];

navLinks.forEach((link) => {
  link.classList.toggle("active", link.dataset.pageLink === currentPage);
  link.addEventListener("click", () => {
    nav?.classList.remove("open");
    navToggle?.setAttribute("aria-expanded", "false");
  });
});

navToggle?.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

const filterButtons = [...document.querySelectorAll("[data-filter]")];
const cards = [...document.querySelectorAll("[data-category]")];

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("active", item === button));
    cards.forEach((card) => {
      card.classList.toggle("is-hidden", filter !== "all" && card.dataset.category !== filter);
    });
  });
});

document.querySelector("[data-contact-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const note = document.querySelector("[data-form-note]");
  event.currentTarget.reset();
  note.textContent = "已收到需求。正式上線時可串接 Email、LINE 或表單系統。";
});
