import * as React from 'react';
import { useLocation } from 'react-router-dom';
import NativeAppBottomNav, { NATIVE_APP_BOTTOM_OFFSET, shouldRenderNativeAppBottomNav } from '@/components/layout/NativeAppBottomNav';
import { useAppRuntime } from '@/lib/appRuntime';

const NATIVE_APP_CLASSNAME = 'toonparrot-native-app';

const NativeAppChrome = () => {
  const location = useLocation();
  const { isNativeApp } = useAppRuntime();
  const shouldShowBottomNav = isNativeApp && shouldRenderNativeAppBottomNav(location.pathname);

  React.useEffect(() => {
    if (!isNativeApp || typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.add(NATIVE_APP_CLASSNAME);
    document.body.classList.add(NATIVE_APP_CLASSNAME);

    return () => {
      document.documentElement.classList.remove(NATIVE_APP_CLASSNAME);
      document.body.classList.remove(NATIVE_APP_CLASSNAME);
    };
  }, [isNativeApp]);

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.style.setProperty(
      '--mobile-app-bottom-offset',
      shouldShowBottomNav ? NATIVE_APP_BOTTOM_OFFSET : '0px',
    );

    return () => {
      document.documentElement.style.setProperty('--mobile-app-bottom-offset', '0px');
    };
  }, [shouldShowBottomNav]);

  if (!isNativeApp) {
    return null;
  }

  return <NativeAppBottomNav />;
};

export default NativeAppChrome;
