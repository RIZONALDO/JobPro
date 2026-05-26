// JobPro Service Worker — Web Push handler
// Nenhuma estratégia de cache aqui; apenas recebe push e mostra notificação nativa.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = { title: "JobPro", body: "", url: "/" };
  try { payload = { ...payload, ...event.data.json() }; } catch { /**/ }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url: payload.url ?? "/" },
      tag: "jobpro-notif",         // agrupa: substitui notif anterior do mesmo tag
      renotify: true,               // toca o som mesmo substituindo
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        // Se já há uma aba aberta, foca nela e navega
        for (const client of list) {
          if ("focus" in client) {
            client.focus();
            client.navigate?.(url);
            return;
          }
        }
        // Caso contrário abre nova aba
        return clients.openWindow(url);
      })
  );
});
