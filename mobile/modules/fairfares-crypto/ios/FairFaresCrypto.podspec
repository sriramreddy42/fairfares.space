Pod::Spec.new do |s|
  s.name           = 'FairFaresCrypto'
  s.version        = '1.0.0'
  s.summary        = 'Streaming native attachment cryptography for FairFares'
  s.description    = 'Authenticated chunked AES-GCM file encryption and decryption.'
  s.author         = 'FairFares'
  s.homepage       = 'https://fairfare.space'
  s.platforms      = { :ios => '13.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,mm,swift}'
  s.swift_version  = '5.9'
end
