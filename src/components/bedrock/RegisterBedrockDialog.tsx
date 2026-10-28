import { useEffect, useState } from 'react'
import { Checkbox } from '../ui/primitives'
import { ConfirmDialog } from '../ui/overlays'

/**
 * Registering an unpacked build hands the Minecraft package over to that copy
 * for the signed-in Windows account, so the Store version stops working until it
 * is installed again. Older builds can also require framework packages current
 * Windows no longer ships, which the checkbox can drop from the manifest.
 */
export function RegisterBedrockDialog({
  version,
  onCancel,
  onConfirm,
}: {
  version: string | null
  onCancel: () => void
  onConfirm: (options: { ignoreMissingDependencies: boolean }) => void
}) {
  const [ignoreMissing, setIgnoreMissing] = useState(true)

  useEffect(() => {
    if (version) setIgnoreMissing(true)
  }, [version])

  return (
    <ConfirmDialog
      open={version !== null}
      tone="primary"
      title={version ? `Register Bedrock ${version}?` : 'Register this build?'}
      description={
        <>
          Windows will replace your Microsoft Store copy of Minecraft for Windows with this downloaded build for your
          account, so the Store version stops working until you install it again. Registration runs as you — no
          administrator is needed with Developer Mode on — and the Store can overwrite the build on its next update.
          <br />
          <br />
          To undo it later, open the Microsoft Store, find Minecraft for Windows under Library, and install it again.
        </>
      }
      confirmLabel="Register build"
      onCancel={onCancel}
      onConfirm={() => onConfirm({ ignoreMissingDependencies: ignoreMissing })}
    >
      <Checkbox checked={ignoreMissing} onChange={setIgnoreMissing}>
        Try anyway when a required framework is missing. Older builds ask for framework packages Windows 11 no longer
        ships, and Aqua drops just those requirements from the build's manifest; the build may still start without them.
      </Checkbox>
    </ConfirmDialog>
  )
}
