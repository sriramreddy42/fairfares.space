/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: "notification-service",
  name: "FChatNotificationService",
  displayName: "FChat Notification Service",
  bundleIdentifier: ".fchat-notification-service",
  deploymentTarget: "15.1",
  frameworks: ["Intents", "UserNotifications"],
});
