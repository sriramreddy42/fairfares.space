/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: "notification-service",
  name: "FChatNotificationService",
  displayName: "Chitthi Notification Service",
  bundleIdentifier: ".fchat-notification-service",
  deploymentTarget: "15.1",
  frameworks: ["Intents", "UIKit", "UserNotifications"],
  entitlements: {
    "keychain-access-groups": ["$(AppIdentifierPrefix)com.fairfares.mobile.shared"]
  },
});
