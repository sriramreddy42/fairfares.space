import Intents
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
        let senderImage = avatarData.map(INImage.init(imageData:))
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
            completion(data)
        }.resume()
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
