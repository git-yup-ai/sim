'use client'

import React from 'react'
import { Tooltip } from '@/components/emcn'
import { SettingsLoader } from './settings-loader'

interface ProvidersProps {
  children: React.ReactNode
}

const Providers = React.memo<ProvidersProps>(({ children }) => {
  return (
    <>
      <SettingsLoader />
      <Tooltip.Provider delayDuration={600} skipDelayDuration={0}>
        {children}
      </Tooltip.Provider>
    </>
  )
})

Providers.displayName = 'Providers'

export default Providers
