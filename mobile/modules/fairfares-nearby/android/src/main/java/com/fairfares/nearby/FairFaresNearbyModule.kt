package com.fairfares.nearby

import android.content.Context
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap

class FairFaresNearbyModule : Module() {
  private val serviceId = "com.fairfares.mobile.chitthi.relay.v1"
  private val strategy = Strategy.P2P_CLUSTER
  private val connected = ConcurrentHashMap.newKeySet<String>()
  private val requested = ConcurrentHashMap.newKeySet<String>()
  private val payloadWindows = ConcurrentHashMap<String, Pair<Long, Int>>()
  private var running = false
  private var displayName = "FairFares"

  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  private val client: ConnectionsClient
    get() = Nearby.getConnectionsClient(context)

  override fun definition() = ModuleDefinition {
    Name("FairFaresNearby")
    Events("onStatus", "onPayload")

    AsyncFunction("start") { name: String ->
      displayName = name.take(32).ifBlank { "FairFares" }
      running = true
      startAdvertising()
      startDiscovery()
      statusMap("starting")
    }

    AsyncFunction("stop") {
      stopEverything()
      statusMap("stopped")
    }

    AsyncFunction("send") { rawPayload: String ->
      val bytes = rawPayload.toByteArray(StandardCharsets.UTF_8)
      require(bytes.size <= 48 * 1024) { "Nearby relay payload is too large." }
      val peers = connected.toList()
      if (peers.isNotEmpty()) client.sendPayload(peers, Payload.fromBytes(bytes))
      mapOf("sent" to peers.size)
    }

    AsyncFunction("sendTo") { endpointId: String, rawPayload: String ->
      val bytes = rawPayload.toByteArray(StandardCharsets.UTF_8)
      require(bytes.size <= 48 * 1024) { "Nearby relay payload is too large." }
      if (connected.contains(endpointId)) {
        client.sendPayload(endpointId, Payload.fromBytes(bytes))
        mapOf("sent" to 1)
      } else {
        mapOf("sent" to 0)
      }
    }

    AsyncFunction("status") { statusMap(if (running) "active" else "stopped") }
    OnDestroy { stopEverything() }
  }

  private fun statusMap(state: String, detail: String = "") = mapOf(
    "running" to running,
    "peers" to connected.size,
    "state" to state,
    "detail" to detail
  )

  private fun emitStatus(state: String, detail: String = "") {
    sendEvent("onStatus", statusMap(state, detail))
  }

  private fun startAdvertising() {
    val options = AdvertisingOptions.Builder().setStrategy(strategy).build()
    client.startAdvertising(displayName, serviceId, lifecycleCallback, options)
      .addOnSuccessListener { emitStatus("advertising") }
      .addOnFailureListener { emitStatus("error", it.message ?: "Advertising failed") }
  }

  private fun startDiscovery() {
    val options = DiscoveryOptions.Builder().setStrategy(strategy).build()
    client.startDiscovery(serviceId, discoveryCallback, options)
      .addOnSuccessListener { emitStatus("discovering") }
      .addOnFailureListener { emitStatus("error", it.message ?: "Discovery failed") }
  }

  private val discoveryCallback = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      if (!running || connected.contains(endpointId) || !requested.add(endpointId)) return
      client.requestConnection(displayName, endpointId, lifecycleCallback)
        .addOnFailureListener {
          requested.remove(endpointId)
          emitStatus("discovery_error", it.message ?: "Connection request failed")
        }
    }

    override fun onEndpointLost(endpointId: String) {
      requested.remove(endpointId)
    }
  }

  private val lifecycleCallback = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      // Relay bundles carry an independent sender signature and E2EE ciphertext.
      // The peer cannot forge or read them; malformed payloads are dropped in JS/server validation.
      if (connected.size >= 8) client.rejectConnection(endpointId)
      else client.acceptConnection(endpointId, payloadCallback)
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      requested.remove(endpointId)
      if (result.status.isSuccess) {
        connected.add(endpointId)
        emitStatus("connected")
      } else {
        connected.remove(endpointId)
        emitStatus("connection_rejected", result.status.statusMessage ?: "Connection rejected")
      }
    }

    override fun onDisconnected(endpointId: String) {
      connected.remove(endpointId)
      requested.remove(endpointId)
      emitStatus("disconnected")
    }
  }

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      if (payload.type != Payload.Type.BYTES) return
      val bytes = payload.asBytes() ?: return
      if (bytes.size > 48 * 1024) return
      val now = System.currentTimeMillis()
      val window = payloadWindows[endpointId]
      val current = if (window == null || now - window.first >= 60_000) Pair(now, 1) else Pair(window.first, window.second + 1)
      payloadWindows[endpointId] = current
      if (current.second > 20) return
      sendEvent("onPayload", mapOf("endpointId" to endpointId, "payload" to String(bytes, StandardCharsets.UTF_8)))
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
  }

  private fun stopEverything() {
    running = false
    runCatching { client.stopAdvertising() }
    runCatching { client.stopDiscovery() }
    runCatching { client.stopAllEndpoints() }
    connected.clear()
    requested.clear()
    payloadWindows.clear()
  }
}
