import CryptoKit
import Intents
import OSLog
import Security
import UIKit
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {

    private let logger = Logger(subsystem: "com.fairfares.mobile.fchat-notification-service", category: "notification")
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?
    private var hasDelivered = false

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let content = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        let payload = notificationData(from: request.content.userInfo)
        if stringValue(payload["type"]) == "FAIRFARES_PROMO" {
            attachPromotionalImage(
                to: content,
                from: URL(string: stringValue(payload["imageUrl"]))
            )
            return
        }
        let notificationType = stringValue(payload["type"])
        guard notificationType == "CHITTHI_MESSAGE" || notificationType == "FCHAT_MESSAGE" || notificationType == "CHITTHI_REACTION" else {
            logger.notice("Bypassing non-Chitthi notification type=\(notificationType, privacy: .public)")
            deliver(content)
            return
        }

        content.sound = .default

        let senderName = stringValue(payload["senderName"]).isEmpty
            ? (content.title.isEmpty ? "FairFares member" : content.title)
            : stringValue(payload["senderName"])
        let senderId = stringValue(payload["senderId"]).isEmpty
            ? senderName
            : stringValue(payload["senderId"])
        let conversationId = stringValue(payload["conversationId"])
        let payloadConversationName = stringValue(payload["conversationName"])
        // `subtitle` comes from aps.alert and is defined by Apple/Expo as
        // standard presentation data. It remains available even if a provider
        // changes how the custom `data` object is wrapped. Direct Chitthi
        // pushes never set a subtitle, so a non-empty value is authoritative
        // group context and must never be cleared by custom-payload parsing.
        let conversationName = payloadConversationName.isEmpty
            ? content.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
            : payloadConversationName
        let groupAvatarValue = stringValue(payload["groupAvatarUrl"])
        // Older/out-of-order push rows can omit the boolean even though their
        // canonical group name or avatar is present. Treat those durable group
        // signals as authoritative so a group letter never renders as direct.
        let isGroup = boolValue(payload["isGroup"])
            || !conversationName.isEmpty
            || !groupAvatarValue.isEmpty
        logger.notice(
            "Resolved Chitthi payload type=\(notificationType, privacy: .public) conversation=\(conversationId, privacy: .private(mask: .hash)) isGroup=\(isGroup, privacy: .public) hasGroupName=\(!conversationName.isEmpty, privacy: .public) hasGroupAvatar=\(!groupAvatarValue.isEmpty, privacy: .public)"
        )
        // Direct chats display the sender. Group chats display the group image,
        // matching the native communication-notification hierarchy.
        let avatarUrl = URL(string: isGroup
            ? groupAvatarValue
            : stringValue(payload["senderAvatarUrl"])
        )
        let avatarFallbackName = isGroup
            ? (conversationName.isEmpty ? "Chitthi group" : conversationName)
            : senderName

        var resolvedBody = content.body
        if let preview = decryptPreview(payload), !preview.isEmpty {
            resolvedBody = preview
            logger.notice("Decrypted notification preview successfully")
        } else if boolValue(payload["isMention"]) {
            resolvedBody = "Mentioned you in a group message"
            logger.notice("Mention preview unavailable; using mention fallback")
        } else if isEncryptedPlaceholder(content.body) {
            resolvedBody = "New Chitthi letter"
            logger.notice("Preview unavailable; using encrypted-message fallback")
        }
        if isGroup {
            resolvedBody = removingGroupFallbackPrefix(from: resolvedBody, conversationName: conversationName)
        }
        applyCanonicalStructure(
            to: content,
            body: resolvedBody,
            senderName: senderName,
            conversationId: conversationId,
            conversationName: conversationName,
            isGroup: isGroup
        )

        loadAvatar(from: avatarUrl) { [weak self] avatarData in
            guard let self else { return }
            self.logger.notice("Avatar resolution completed hasImage=\(avatarData != nil, privacy: .public)")
            self.deliverCommunicationNotification(
                content: content,
                senderName: senderName,
                senderId: senderId,
                conversationId: conversationId,
                conversationName: conversationName,
                isGroup: isGroup,
                recipients: communicationRecipients(from: payload),
                avatarFallbackName: avatarFallbackName,
                avatarData: avatarData
            )
        }
    }

    override func serviceExtensionTimeWillExpire() {
        logger.error("Notification service time limit reached; delivering canonical fallback")
        if let content = bestAttemptContent {
            deliver(content)
        }
    }

    private func deliverCommunicationNotification(
        content: UNMutableNotificationContent,
        senderName: String,
        senderId: String,
        conversationId: String,
        conversationName: String,
        isGroup: Bool,
        recipients: [INPerson],
        avatarFallbackName: String,
        avatarData: Data?
    ) {
        // Preserve these before asking Intents to enrich the content. iOS is
        // free to rearrange title/subtitle/body in `updating(from:)`; restoring
        // the canonical values afterwards keeps the completed and timeout
        // delivery paths visually identical.
        let canonicalTitle = content.title
        let canonicalSubtitle = content.subtitle
        let canonicalBody = content.body
        let canonicalThreadIdentifier = content.threadIdentifier
        let canonicalTargetContentIdentifier = content.targetContentIdentifier
        // Intent enrichment may return newly constructed notification content.
        // Keep the original routing payload so a tap still reaches the exact
        // conversation and message after iOS applies communication styling.
        let canonicalUserInfo = content.userInfo
        let senderHandle = INPersonHandle(value: senderId, type: .unknown)
        let normalizedAvatarData = avatarData ?? initialsAvatarData(for: avatarFallbackName)
        let communicationImage = normalizedAvatarData.map(INImage.init(imageData:))
        let sender = INPerson(
            personHandle: senderHandle,
            nameComponents: nil,
            displayName: senderName,
            image: isGroup ? nil : communicationImage,
            contactIdentifier: nil,
            customIdentifier: senderId,
            isMe: false,
            suggestionType: .none
        )
        let groupName: INSpeakableString? = isGroup && !conversationName.isEmpty
            ? INSpeakableString(spokenPhrase: conversationName)
            : nil
        let intent = INSendMessageIntent(
            recipients: isGroup && !recipients.isEmpty ? recipients : nil,
            outgoingMessageType: .outgoingMessageText,
            content: content.body,
            speakableGroupName: groupName,
            conversationIdentifier: conversationId,
            serviceName: "Chitthi",
            sender: sender,
            attachments: nil
        )
        if isGroup, let communicationImage {
            intent.setImage(communicationImage, forParameterNamed: \.speakableGroupName)
        }
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate { [weak self] _ in
            guard let self else { return }
            do {
                let updated = try content.updating(from: intent)
                guard let normalized = updated.mutableCopy() as? UNMutableNotificationContent else {
                    self.deliver(content)
                    return
                }
                normalized.title = canonicalTitle
                normalized.subtitle = canonicalSubtitle
                normalized.body = canonicalBody
                normalized.threadIdentifier = canonicalThreadIdentifier
                normalized.targetContentIdentifier = canonicalTargetContentIdentifier
                normalized.userInfo = canonicalUserInfo
                self.logger.notice("Communication notification rendering completed")
                self.deliver(normalized)
            } catch {
                self.logger.error("Communication rendering failed: \(String(describing: error), privacy: .public)")
                self.deliver(content)
            }
        }
    }

    private func applyCanonicalStructure(
        to content: UNMutableNotificationContent,
        body: String,
        senderName: String,
        conversationId: String,
        conversationName: String,
        isGroup: Bool
    ) {
        content.title = senderName
        content.subtitle = isGroup
            ? (conversationName.isEmpty ? "Chitthi group" : conversationName)
            : ""
        content.body = body
        if !conversationId.isEmpty {
            content.threadIdentifier = conversationId
            content.targetContentIdentifier = conversationId
        }
    }

    private func removingGroupFallbackPrefix(from body: String, conversationName: String) -> String {
        guard !conversationName.isEmpty else { return body }
        let prefix = "\(conversationName)\n"
        return body.hasPrefix(prefix) ? String(body.dropFirst(prefix.count)) : body
    }

    private func communicationRecipients(from payload: [AnyHashable: Any]) -> [INPerson] {
        guard let values = payload["communicationRecipients"] as? [Any] else { return [] }
        return values.prefix(8).compactMap { value in
            let item: [AnyHashable: Any]
            if let dictionary = value as? [AnyHashable: Any] {
                item = dictionary
            } else if let dictionary = value as? [String: Any] {
                item = Dictionary(uniqueKeysWithValues: dictionary.map { (AnyHashable($0.key), $0.value) })
            } else {
                return nil
            }
            let identifier = stringValue(item["id"])
            let name = stringValue(item["name"])
            guard !identifier.isEmpty, !name.isEmpty else { return nil }
            return INPerson(
                personHandle: INPersonHandle(value: identifier, type: .unknown),
                nameComponents: nil,
                displayName: name,
                image: nil,
                contactIdentifier: nil,
                customIdentifier: identifier,
                isMe: false,
                suggestionType: .none
            )
        }
    }

    private func loadAvatar(from url: URL?, completion: @escaping (Data?) -> Void) {
        guard let url, url.scheme == "https" else {
            completion(nil)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 6
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let http = response as? HTTPURLResponse
            guard let data,
                  data.count <= 2_000_000,
                  let status = http?.statusCode,
                  (200 ... 299).contains(status) else {
                completion(nil)
                return
            }
            // INImage can silently produce a blank communication avatar when
            // it receives WebP, HTML, SVG, or otherwise malformed image data.
            // Decode it with UIKit and hand Intents a normalized PNG instead.
            guard let image = UIImage(data: data),
                  image.size.width > 0,
                  image.size.height > 0,
                  let pngData = image.pngData(),
                  pngData.count <= 2_000_000 else {
                completion(nil)
                return
            }
            completion(pngData)
        }.resume()
    }

    private func attachPromotionalImage(to content: UNMutableNotificationContent, from url: URL?) {
        guard let url, url.scheme == "https" else {
            deliver(content)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        URLSession.shared.downloadTask(with: request) { [weak self] temporaryUrl, response, _ in
            guard let self else { return }
            let http = response as? HTTPURLResponse
            guard let temporaryUrl,
                  let status = http?.statusCode,
                  (200 ... 299).contains(status) else {
                self.deliver(content)
                return
            }
            do {
                let directory = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true,
                    attributes: nil
                )
                let fileExtension = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
                let localUrl = directory.appendingPathComponent("fairfares-promo.\(fileExtension)")
                try FileManager.default.copyItem(at: temporaryUrl, to: localUrl)
                let attachment = try UNNotificationAttachment(
                    identifier: "fairfares-promotional-image",
                    url: localUrl
                )
                content.attachments = [attachment]
            } catch {
                // Keep the useful title and body when iOS cannot attach media.
            }
            self.deliver(content)
        }.resume()
    }

    private func isEncryptedPlaceholder(_ value: String) -> Bool {
        let normalized = value.lowercased()
        return normalized.contains("end-to-end encrypted message")
            || normalized.contains("sent you a secure message")
            || normalized.contains("new chitthi message")
            || normalized.contains("chitthi message")
            || normalized == "encrypted message"
    }

    private func decryptPreview(_ payload: [AnyHashable: Any]) -> String? {
        let userId = stringValue(payload["recipientUserId"])
        let deviceId = stringValue(payload["recipientDeviceId"])
        guard !userId.isEmpty, !deviceId.isEmpty,
              let senderPublic = Data(base64Encoded: stringValue(payload["senderPublicKey"])),
              let nonceData = Data(base64Encoded: stringValue(payload["previewNonce"])), nonceData.count == 12,
              let sealedData = Data(base64Encoded: stringValue(payload["previewCiphertext"])), sealedData.count > 16,
              let identityData = sharedIdentityData(userId: userId),
              let identity = try? JSONSerialization.jsonObject(with: identityData) as? [String: Any],
              let secretBase64 = identity["secretKey"] as? String,
              let secretData = Data(base64Encoded: secretBase64),
              let privateKey = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secretData),
              let publicKey = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: senderPublic),
              let shared = try? privateKey.sharedSecretFromKeyAgreement(with: publicKey) else { return nil }
        let sharedData = shared.withUnsafeBytes { Data($0) }
        for domainLabel in ["FairFares Chitthi notification preview v1", "FairFares FChat notification preview v1"] {
            let domain = Data(domainLabel.utf8)
            let key = SymmetricKey(data: Data(SHA256.hash(data: domain + sharedData)))
            do {
                let nonce = try ChaChaPoly.Nonce(data: nonceData)
                let ciphertext = sealedData.dropLast(16)
                let tag = sealedData.suffix(16)
                let box = try ChaChaPoly.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
                let clear = try ChaChaPoly.open(box, using: key)
                return String(data: clear, encoding: .utf8)
            } catch {
                continue
            }
        }
        return nil
    }

    private func sharedIdentityData(userId: String) -> Data? {
        for (service, account) in [
            ("fairfares-chitthi-notification:no-auth", "fairfares.chitthi.e2ee.\(userId)"),
            ("fairfares-fchat-notification:no-auth", "fairfares.fchat.e2ee.\(userId)")
        ] {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                // expo-secure-store appends this alias for non-biometric items.
                kSecAttrService as String: service,
                kSecAttrAccount as String: Data(account.utf8),
                kSecAttrAccessGroup as String: "9RVTF77D2S.com.fairfares.mobile.shared",
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne
            ]
            var item: CFTypeRef?
            if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
                return data
            }
        }
        return nil
    }

    private func initialsAvatarData(for name: String) -> Data? {
        let words = name.split(whereSeparator: { $0.isWhitespace })
        let initials = words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        guard !initials.isEmpty else { return nil }

        let size = CGSize(width: 192, height: 192)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            UIColor(red: 0.10, green: 0.25, blue: 0.55, alpha: 1).setFill()
            context.cgContext.fill(CGRect(origin: .zero, size: size))
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 70, weight: .semibold),
                .foregroundColor: UIColor.white
            ]
            let text = NSString(string: initials)
            let bounds = text.size(withAttributes: attributes)
            text.draw(
                at: CGPoint(x: (size.width - bounds.width) / 2, y: (size.height - bounds.height) / 2),
                withAttributes: attributes
            )
        }
        return image.pngData()
    }

    private func deliver(_ content: UNNotificationContent) {
        guard !hasDelivered, let handler = contentHandler else { return }
        hasDelivered = true
        handler(content)
    }

    private func stringValue(_ value: Any?) -> String {
        if let value = value as? String { return value }
        if let value = value as? NSNumber { return value.stringValue }
        return ""
    }

    private func notificationData(from userInfo: [AnyHashable: Any]) -> [AnyHashable: Any] {
        // Expo's APNs provider can place the application `data` object at the
        // root, under `data`, `body`, or a provider-owned wrapper depending on
        // the delivery path and SDK version. Expo Notifications unwraps this
        // for JavaScript, but the native service extension receives raw APNs.
        return findNotificationData(in: userInfo, depth: 0, path: "root") ?? userInfo
    }

    private func findNotificationData(in value: Any, depth: Int, path: String) -> [AnyHashable: Any]? {
        guard depth < 5 else { return nil }
        if let payload = value as? [AnyHashable: Any] {
            // Expo/APNs can copy a small routing subset (type and
            // conversationId) onto an outer dictionary while keeping the
            // complete application payload under `data` or another wrapper.
            // Inspect nested wrappers first; returning the outer dictionary
            // here loses isGroup, conversationName, and avatar fields even
            // though navigation still reaches the correct conversation.
            for key in ["data", "body", "payload", "custom", "notification"] {
                if let nested = payload[key],
                   let found = findNotificationData(in: nested, depth: depth + 1, path: "\(path).\(key)") {
                    return found
                }
            }
            for nested in payload.values {
                if let found = findNotificationData(in: nested, depth: depth + 1, path: "\(path).value") {
                    return found
                }
            }
            if !stringValue(payload["type"]).isEmpty {
                logger.notice("Selected notification payload layer=\(path, privacy: .public) depth=\(depth, privacy: .public)")
                return payload
            }
        } else if let payload = value as? [String: Any] {
            return findNotificationData(
                in: Dictionary(uniqueKeysWithValues: payload.map { (AnyHashable($0.key), $0.value) }),
                depth: depth,
                path: path
            )
        } else if let encoded = value as? String,
                  encoded.count <= 8_192,
                  let data = encoded.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) {
            return findNotificationData(in: object, depth: depth + 1, path: "\(path).json")
        }
        return nil
    }

    private func boolValue(_ value: Any?) -> Bool {
        if let value = value as? Bool { return value }
        if let value = value as? NSNumber { return value.boolValue }
        if let value = value as? String { return ["1", "true", "yes"].contains(value.lowercased()) }
        return false
    }

}
