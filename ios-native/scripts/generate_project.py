"""Generate the checked-in Xcode project without installing XcodeGen on Windows.

Run after adding Swift files: python ios-native/scripts/generate_project.py
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'Bisik.xcodeproj'
PROJECT.mkdir(exist_ok=True)
objects = {}

def uid(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()

def q(value):
    return json.dumps(str(value))

def arr(values):
    return '(' + ', '.join(values) + ',)' if values else '()'

def obj(object_key, isa, **fields):
    ident = uid(object_key)
    objects[ident] = f'isa = {isa}; ' + ' '.join(f'{k} = {v};' for k, v in fields.items())
    return ident

source_ids, resource_ids, test_ids, file_ids = [], [], [], []
paths = sorted((ROOT / 'Bisik').rglob('*.swift')) + sorted((ROOT / 'BisikTests').rglob('*.swift'))
paths += [ROOT / 'Bisik/Resources/Inter-Regular.ttf', ROOT / 'Bisik/Resources/Inter-SemiBold.ttf', ROOT / 'Bisik/Resources/Inter-LICENSE.txt', ROOT / 'Bisik/Resources/PrivacyInfo.xcprivacy', ROOT / 'Bisik/Resources/Assets.xcassets']
paths += [ROOT / 'Bisik/Resources/Info.plist', ROOT / 'Bisik/Resources/Bisik.entitlements', ROOT / 'Config/Developer.xcconfig', ROOT / 'Bisik/Resources/Bisik.storekit']
types = {'.swift': 'sourcecode.swift', '.ttf': 'file', '.plist': 'text.plist.xml', '.xcprivacy': 'text.xml', '.entitlements': 'text.plist.entitlements', '.xcconfig': 'text.xcconfig', '.storekit': 'text', '.xcassets': 'folder.assetcatalog'}
for path in paths:
    rel = path.relative_to(ROOT).as_posix()
    ref = obj('file:' + rel, 'PBXFileReference', lastKnownFileType=q(types.get(path.suffix, 'text')), path=q(rel), sourceTree=q('<group>'))
    file_ids.append(ref)
    if path.suffix == '.swift':
        build = obj('build:' + rel, 'PBXBuildFile', fileRef=ref)
        (test_ids if rel.startswith('BisikTests/') else source_ids).append(build)
    elif path.suffix in ('.ttf', '.xcprivacy', '.xcassets') or path.name == 'Inter-LICENSE.txt':
        resource_ids.append(obj('build:' + rel, 'PBXBuildFile', fileRef=ref))

app_product = obj('app-product', 'PBXFileReference', explicitFileType=q('wrapper.application'), includeInIndex='0', path=q('Bisik.app'), sourceTree=q('BUILT_PRODUCTS_DIR'))
test_product = obj('test-product', 'PBXFileReference', explicitFileType=q('wrapper.cfbundle'), includeInIndex='0', path=q('BisikTests.xctest'), sourceTree=q('BUILT_PRODUCTS_DIR'))
products = obj('products', 'PBXGroup', children=arr([app_product, test_product]), name=q('Products'), sourceTree=q('<group>'))
main_group = obj('main-group', 'PBXGroup', children=arr(file_ids + [products]), sourceTree=q('<group>'))

def phase(name, kind, files):
    return obj(name, kind, buildActionMask='2147483647', files=arr(files), runOnlyForDeploymentPostprocessing='0')

app_phases = [phase('app-sources', 'PBXSourcesBuildPhase', source_ids), phase('app-frameworks', 'PBXFrameworksBuildPhase', []), phase('app-resources', 'PBXResourcesBuildPhase', resource_ids)]
test_phases = [phase('test-sources', 'PBXSourcesBuildPhase', test_ids), phase('test-frameworks', 'PBXFrameworksBuildPhase', []), phase('test-resources', 'PBXResourcesBuildPhase', [])]

base_settings = {'CLANG_ENABLE_MODULES': 'YES', 'SWIFT_VERSION': '5.0', 'IPHONEOS_DEPLOYMENT_TARGET': '17.0', 'SDKROOT': 'iphoneos', 'TARGETED_DEVICE_FAMILY': q('1,2'), 'CODE_SIGN_STYLE': 'Automatic', 'SWIFT_EMIT_LOC_STRINGS': 'YES'}
app_settings = {'PRODUCT_BUNDLE_IDENTIFIER': q('com.maruz75.bisik'), 'PRODUCT_NAME': q('$(TARGET_NAME)'), 'INFOPLIST_FILE': q('Bisik/Resources/Info.plist'), 'GENERATE_INFOPLIST_FILE': 'NO', 'CODE_SIGN_ENTITLEMENTS': q('Bisik/Resources/Bisik.entitlements'), 'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon', 'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME': 'AccentColor', 'LD_RUNPATH_SEARCH_PATHS': q('$(inherited) @executable_path/Frameworks')}
test_settings = {'PRODUCT_BUNDLE_IDENTIFIER': q('com.maruz75.bisik.tests'), 'PRODUCT_NAME': q('$(TARGET_NAME)'), 'GENERATE_INFOPLIST_FILE': 'YES', 'BUNDLE_LOADER': q('$(TEST_HOST)'), 'TEST_HOST': q('$(BUILT_PRODUCTS_DIR)/Bisik.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Bisik'), 'LD_RUNPATH_SEARCH_PATHS': q('$(inherited) @executable_path/Frameworks @loader_path/Frameworks')}

def configs(scope, settings, is_target=False):
    ids = []
    for mode in ['Debug', 'Release']:
        s = dict(settings)
        if mode == 'Debug':
            s.update({'SWIFT_OPTIMIZATION_LEVEL': q('-Onone'), 'ENABLE_TESTABILITY': 'YES', 'DEBUG_INFORMATION_FORMAT': 'dwarf', 'SWIFT_ACTIVE_COMPILATION_CONDITIONS': q('$(inherited) DEBUG')})
        else:
            s.update({'SWIFT_OPTIMIZATION_LEVEL': q('-O'), 'SWIFT_COMPILATION_MODE': 'wholemodule', 'DEBUG_INFORMATION_FORMAT': q('dwarf-with-dsym')})
        fields = {'buildSettings': '{ ' + ' '.join(f'{k} = {v};' for k, v in s.items()) + ' }', 'name': q(mode)}
        if is_target:
            fields['baseConfigurationReference'] = uid('file:Config/Developer.xcconfig')
        ids.append(obj(scope + ':' + mode, 'XCBuildConfiguration', **fields))
    return obj(scope + ':configs', 'XCConfigurationList', buildConfigurations=arr(ids), defaultConfigurationIsVisible='0', defaultConfigurationName=q('Release'))

project_configs = configs('project', base_settings)
app_configs = configs('app', app_settings, True)
test_configs = configs('test', test_settings, True)
app_id = uid('app-target')
project_id = uid('project')
proxy = obj('dependency-proxy', 'PBXContainerItemProxy', containerPortal=project_id, proxyType='1', remoteGlobalIDString=app_id, remoteInfo=q('Bisik'))
dependency = obj('test-dependency', 'PBXTargetDependency', target=app_id, targetProxy=proxy)
obj('app-target', 'PBXNativeTarget', buildConfigurationList=app_configs, buildPhases=arr(app_phases), buildRules='()', dependencies='()', name=q('Bisik'), productName=q('Bisik'), productReference=app_product, productType=q('com.apple.product-type.application'))
test_id = obj('test-target', 'PBXNativeTarget', buildConfigurationList=test_configs, buildPhases=arr(test_phases), buildRules='()', dependencies=arr([dependency]), name=q('BisikTests'), productName=q('BisikTests'), productReference=test_product, productType=q('com.apple.product-type.bundle.unit-test'))
obj('project', 'PBXProject', attributes='{ LastUpgradeCheck = 1630; BuildIndependentTargetsInParallel = YES; TargetAttributes = { ' + app_id + ' = { CreatedOnToolsVersion = 16.3; SystemCapabilities = { com.apple.SignInWithApple = { enabled = 1; }; }; }; ' + test_id + ' = { CreatedOnToolsVersion = 16.3; TestTargetID = ' + app_id + '; }; }; }', buildConfigurationList=project_configs, compatibilityVersion=q('Xcode 14.0'), developmentRegion='id', hasScannedForEncodings='0', knownRegions=arr(['id', 'en', 'Base']), mainGroup=main_group, productRefGroup=products, projectDirPath=q(''), projectRoot=q(''), targets=arr([app_id, test_id]))
content = '// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'
content += '\n'.join(f'{ident} = {{ {body} }};' for ident, body in objects.items())
content += '\n}; rootObject = ' + project_id + '; }\n'
(PROJECT / 'project.pbxproj').write_text(content, encoding='utf-8')
scheme_dir = PROJECT / 'xcshareddata/xcschemes'
scheme_dir.mkdir(parents=True, exist_ok=True)
app_ref = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{app_id}" BuildableName="Bisik.app" BlueprintName="Bisik" ReferencedContainer="container:Bisik.xcodeproj"/>'
test_ref = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{test_id}" BuildableName="BisikTests.xctest" BlueprintName="BisikTests" ReferencedContainer="container:Bisik.xcodeproj"/>'
(scheme_dir / 'Bisik.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1630" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
<BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{app_ref}</BuildActionEntry>
<BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="NO">{test_ref}</BuildActionEntry>
</BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{test_ref}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{app_ref}</BuildableProductRunnable><StoreKitConfigurationFileReference identifier="../../../Bisik/Resources/Bisik.storekit"/></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{app_ref}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''', encoding='utf-8')
print(f'Generated {PROJECT} ({len(source_ids)} app sources, {len(test_ids)} test sources)')
