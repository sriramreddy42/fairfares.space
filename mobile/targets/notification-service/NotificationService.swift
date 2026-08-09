import CryptoKit
import Intents
import Security
import UIKit
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {

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
        guard stringValue(payload["type"]) == "FCHAT_MESSAGE" else {
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
        let conversationName = stringValue(payload["conversationName"])
        let isGroup = boolValue(payload["isGroup"])
        let avatarUrl = URL(string: stringValue(payload["senderAvatarUrl"]))

        if let preview = decryptPreview(payload), !preview.isEmpty {
            content.body = preview
        } else if isEncryptedPlaceholder(content.body) {
            content.body = "New FChat message"
        }

        loadAvatar(from: avatarUrl) { [weak self] avatarData in
            guard let self else { return }
            self.deliverCommunicationNotification(
                content: content,
                senderName: senderName,
                senderId: senderId,
                conversationId: conversationId,
                conversationName: conversationName,
                isGroup: isGroup,
                avatarData: avatarData
            )
        }
    }

    override func serviceExtensionTimeWillExpire() {
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
        avatarData: Data?
    ) {
        let senderHandle = INPersonHandle(value: senderId, type: .unknown)
        let normalizedAvatarData = avatarData ?? initialsAvatarData(for: senderName)
        let senderImage = normalizedAvatarData.map(INImage.init(imageData:))
        let sender = INPerson(
            personHandle: senderHandle,
            nameComponents: nil,
            displayName: senderName,
            image: senderImage,
            contactIdentifier: nil,
            customIdentifier: senderId,
            isMe: false,
            suggestionType: .none
        )
        let groupName: INSpeakableString? = isGroup && !conversationName.isEmpty
            ? INSpeakableString(spokenPhrase: conversationName)
            : nil
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: content.body,
            speakableGroupName: groupName,
            conversationIdentifier: conversationId,
            serviceName: "FChat",
            sender: sender,
            attachments: nil
        )
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate { [weak self] _ in
            guard let self else { return }
            do {
                self.deliver(try content.updating(from: intent))
            } catch {
                self.deliver(content)
            }
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
        let domain = Data("FairFares FChat notification preview v1".utf8)
        let sharedData = shared.withUnsafeBytes { Data($0) }
        let key = SymmetricKey(data: Data(SHA256.hash(data: domain + sharedData)))
        do {
            let nonce = try ChaChaPoly.Nonce(data: nonceData)
            let ciphertext = sealedData.dropLast(16)
            let tag = sealedData.suffix(16)
            let box = try ChaChaPoly.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            let clear = try ChaChaPoly.open(box, using: key)
            return String(data: clear, encoding: .utf8)
        } catch {
            return nil
        }
    }

    private func sharedIdentityData(userId: String) -> Data? {
        let account = "fairfares.fchat.e2ee.\(userId)"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            // expo-secure-store appends this alias for non-biometric items.
            kSecAttrService as String: "fairfares-fchat-notification:no-auth",
            kSecAttrAccount as String: Data(account.utf8),
            kSecAttrAccessGroup as String: "9RVTF77D2S.com.fairfares.mobile.shared",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
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
        // root, under `data`, or under `body` depending on the delivery path
        // and SDK version. Expo Notifications unwraps this for JavaScript, but
        // a native notification-service extension receives the raw APNs map.
        if !stringValue(userInfo["type"]).isEmpty {
            return userInfo
        }
        for key in ["data", "body"] {
            if let nested = userInfo[key] as? [AnyHashable: Any],
               !stringValue(nested["type"]).isEmpty {
                return nested
            }
            if let nested = userInfo[key] as? [String: Any],
               !stringValue(nested["type"]).isEmpty {
                return Dictionary(uniqueKeysWithValues: nested.map { (AnyHashable($0.key), $0.value) })
            }
            if let encoded = userInfo[key] as? String,
               let data = encoded.data(using: .utf8),
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               !stringValue(object["type"]).isEmpty {
                return Dictionary(uniqueKeysWithValues: object.map { (AnyHashable($0.key), $0.value) })
            }
        }
        return userInfo
    }

    private func boolValue(_ value: Any?) -> Bool {
        if let value = value as? Bool { return value }
        if let value = value as? NSNumber { return value.boolValue }
        if let value = value as? String { return ["1", "true", "yes"].contains(value.lowercased()) }
        return false
    }

}
