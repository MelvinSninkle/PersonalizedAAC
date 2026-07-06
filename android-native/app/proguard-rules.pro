# kotlinx.serialization — keep generated serializers.
-keepclassmembers class io.andrewpeterson.myworld.** {
    *** Companion;
}
-keepclasseswithmembers class io.andrewpeterson.myworld.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class io.andrewpeterson.myworld.**$$serializer { *; }
