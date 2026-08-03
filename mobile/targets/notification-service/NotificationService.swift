import Intents
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

        let payload = request.content.userInfo
        guard stringValue(payload["type"]) == "FCHAT_MESSAGE" else {
            deliver(content)
            return
        }

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

        // The encrypted database placeholder is an internal implementation
        // detail and must never be rendered on the lock screen. The service
        // extension cannot decrypt the FChat envelope without the recipient's
        // device key, so use a truthful privacy-safe preview for now.
        if isEncryptedPlaceholder(content.body) {
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

    private func isEncryptedPlaceholder(_ value: String) -> Bool {
        let normalized = value.lowercased()
        return normalized.contains("end-to-end encrypted message")
            || normalized.contains("sent you a secure message")
            || normalized == "encrypted message"
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

    private func boolValue(_ value: Any?) -> Bool {
        if let value = value as? Bool { return value }
        if let value = value as? NSNumber { return value.boolValue }
        if let value = value as? String { return ["1", "true", "yes"].contains(value.lowercased()) }
        return false
    }

}
