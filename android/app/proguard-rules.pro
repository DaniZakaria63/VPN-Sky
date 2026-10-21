# VPNSky-specific R8 rules.
#
# React Native ships consumer rules for the bridge, Hermes, Yoga and Fresco, and Firebase ships
# its own. These rules cover what only this app knows about.

# The native module is instantiated by React Native's generated PackageList and its @ReactMethod
# surface is invoked reflectively by the bridge. Keeping the small package avoids a class of
# "method not found" crashes that only appear in minified builds.
-keep class com.wingsheep.vpnsky.vpn.VpnPackage { *; }
-keep class com.wingsheep.vpnsky.vpn.VpnSkyVpnModule { *; }

# Declared by name in AndroidManifest.xml.
-keep class com.wireguard.android.backend.GoBackend$VpnService { *; }

# Keep annotation metadata that reflection-based framework code reads.
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault

# The WireGuard tunnel library's JNI entry points are protected by the default
# `-keepclasseswithmembernames class * { native <methods>; }` rule. Do not add broad keeps here.
