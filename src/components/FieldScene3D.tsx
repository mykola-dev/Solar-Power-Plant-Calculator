import { Box, Button, Group, Text } from '@mantine/core'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Text as DreiText } from '@react-three/drei'
import { useRef, useImperativeHandle, forwardRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { SolarMetrics } from '../types'
import { compassDirectionENU, enuToThree, sunVectorToSkyENU } from '../utils/solar3d'

type FieldScene3DProps = {
  rowsCount: number
  panelsPerRow: number
  rowPitchM: number
  panelWidthAcrossRowM: number
  metrics: SolarMetrics
  panelAzimuthDeg: number
  groundTiltDeg: number
  groundTiltAzimuthDeg: number
  rowShadingFractions: number[]
}

type CameraHandle = {
  top: () => void
  side: () => void
  orbit: () => void
}

const DEG_TO_RAD = Math.PI / 180

// Compass labels. enuToThree = [enu.x, enu.z, -enu.y], det=+1 (right-handed).
// ENU north(+Y) → Three -Z; ENU south(-Y) → Three +Z; ENU east(+X) → Three +X
const CompassLabels = () => (
  <group position={[0, 0.05, 0]}>
    <DreiText position={[0, 0, -11.5]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.1} color="#a8c8e8" anchorX="center" anchorY="middle">
      N
    </DreiText>
    <DreiText position={[0, 0, 11.5]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.1} color="#a8c8e8" anchorX="center" anchorY="middle">
      S
    </DreiText>
    <DreiText position={[11.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.1} color="#a8c8e8" anchorX="center" anchorY="middle">
      E
    </DreiText>
    <DreiText position={[-11.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.1} color="#a8c8e8" anchorX="center" anchorY="middle">
      W
    </DreiText>
  </group>
)

const PanelRows = ({
  rowsCount,
  panelsPerRow,
  rowPitchM,
  panelWidthAcrossRowM,
  metrics,
  panelAzimuthDeg,
  rowShadingFractions,
}: FieldScene3DProps) => {
  // panelLengthM is the physical slab length (hypotenuse of run + height)
  const panelLengthM = Math.hypot(metrics.panelRunM, metrics.panelTopHeightM)
  const seamGapM = 0.035
  const singlePanelWidthM = Math.max(panelWidthAcrossRowM - seamGapM, 0.25)
  const rowLengthM = Math.max(panelsPerRow, 1) * singlePanelWidthM + Math.max(panelsPerRow - 1, 0) * seamGapM
  // face = direction panel faces in ENU (south-facing → {x:0,y:-1,z:0})
  const face = compassDirectionENU(panelAzimuthDeg)
  // Use the fixed rowPitchM from state (anchor-to-anchor distance).
  // This ensures rows don't slide when tilt changes.
  const effectivePitchM = Math.max(rowPitchM, 0.1)
  const panelTiltRad = Math.atan2(metrics.panelTopHeightM, Math.max(metrics.panelRunM, 0.01))
  const halfThickness = 0.018

  // enuToThree = [enu.x, enu.z, -enu.y]. Ground points (enu.z=0): Three = [enu.x, 0, -enu.y]
  // rotation.y = PI - azimuthRad: south-facing (az=π) → rot.y=0, local +Z = Three +Z = ENU south ✓
  const azimuthRad = panelAzimuthDeg * DEG_TO_RAD

  return (
    <group>
      {Array.from({ length: rowsCount }, (_, rowIndex) => {
        // Row anchor positions are fixed on the ground, spaced by rowPitchM
        // opposite to the face direction.
        const enuBaseX = -face.x * effectivePitchM * rowIndex
        const enuBaseY = -face.y * effectivePitchM * rowIndex
        const threeX = enuBaseX
        const threeZ = -enuBaseY

        const shading = rowShadingFractions[rowIndex] ?? 0
        const color = shading > 0.65 ? '#4f7da8' : shading > 0.2 ? '#5a8fbc' : '#73afe6'

        // Panel rotates around its FRONT (sun-side) bottom edge on the ground.
        // In local space (after Y-axis rotation for azimuth):
        //   local +Z = face direction (south for south-facing panels)
        //   local -Z = away from sun (north for south-facing)
        //   local +Y = up
        // Front edge anchor at Y=0, Z=0. Panel slab extends in -Z direction.
        // Positive rotation-x raises the -Z (far) end → surface faces +Z (south).

        return (
          <group key={`row3d-${rowIndex}`} position={[threeX, 0, threeZ]} rotation={[0, Math.PI - azimuthRad, 0]}>
            {/* Pivot at ground level (Y=0, Z=0 = front/south edge for south-facing).
                Panel extends in -Z (northward in local space). Positive rotation-x
                raises the -Z end upward, so the irradiated surface faces south. */}
            <group rotation-x={panelTiltRad}>
              {Array.from({ length: Math.max(panelsPerRow, 1) }, (_, panelIndex) => {
                const xStart = -rowLengthM / 2 + singlePanelWidthM / 2
                const x = xStart + panelIndex * (singlePanelWidthM + seamGapM)
                return (
                  <mesh key={`panel-${rowIndex}-${panelIndex}`} castShadow receiveShadow position={[x, 0, -panelLengthM / 2]}>
                    <boxGeometry args={[singlePanelWidthM, halfThickness, panelLengthM]} />
                    <meshStandardMaterial color={color} roughness={0.33} metalness={0.14} />
                  </mesh>
                )
              })}
              {Array.from({ length: Math.max(panelsPerRow - 1, 0) }, (_, seamIndex) => {
                const seamX =
                  -rowLengthM / 2 + (seamIndex + 1) * singlePanelWidthM + seamIndex * seamGapM + seamGapM / 2
                return (
                  <mesh key={`seam-${rowIndex}-${seamIndex}`} castShadow receiveShadow position={[seamX, halfThickness * 0.9, -panelLengthM / 2]}>
                    <boxGeometry args={[seamGapM * 0.85, halfThickness * 0.45, panelLengthM * 0.998]} />
                    <meshStandardMaterial color="#e8eefb" roughness={0.22} metalness={0.08} />
                  </mesh>
                )
              })}
            </group>
          </group>
        )
      })}
    </group>
  )
}

const SunSphere = ({
  solarAzimuthDeg,
  solarAltitudeDeg,
  sunAboveHorizon,
}: {
  solarAzimuthDeg: number
  solarAltitudeDeg: number
  sunAboveHorizon: boolean
}) => {
  if (!sunAboveHorizon) return null
  const dist = 55
  const dir = sunVectorToSkyENU(solarAzimuthDeg, solarAltitudeDeg)
  const pos = enuToThree({
    x: dir.x * dist,
    y: dir.y * dist,
    z: Math.max(dir.z * dist, 1),
  })
  return (
    <group position={pos}>
      {/* core disc */}
      <mesh>
        <sphereGeometry args={[2.6, 24, 24]} />
        <meshBasicMaterial color="#ffe566" />
      </mesh>
      {/* soft halo */}
      <mesh>
        <sphereGeometry args={[3.8, 16, 16]} />
        <meshBasicMaterial color="#ffdd33" transparent opacity={0.13} depthWrite={false} />
      </mesh>
    </group>
  )
}

// Lives inside Canvas to access useThree. Exposes camera preset methods via ref.
const CameraControls = forwardRef<CameraHandle, { controlsRef: React.RefObject<OrbitControlsImpl | null> }>(
  ({ controlsRef }, ref) => {
    const { camera } = useThree()

    useImperativeHandle(ref, () => ({
      top() {
        camera.position.set(0, 28, 0.01)
        camera.lookAt(0, 0, 0)
        controlsRef.current?.update()
      },
      side() {
        // Looking from north toward south: position at ENU north = Three +Z
        // This shows the front (irradiated) face of south-facing panels
        camera.position.set(0, 5, 18)
        camera.lookAt(0, 2, 0)
        controlsRef.current?.update()
      },
      orbit() {
        camera.position.set(10, 6.5, 10)
        camera.lookAt(0, 0, 0)
        controlsRef.current?.update()
      },
    }))

    return null
  },
)
CameraControls.displayName = 'CameraControls'

export function FieldScene3D(props: FieldScene3DProps) {
  const sunDistance = 20
  const sunToSky = sunVectorToSkyENU(props.metrics.solarAzimuthDeg, props.metrics.solarAltitudeDeg)
  // Directional light shines FROM position toward target (origin). Place it at sun direction. ✓
  const sunPosition = enuToThree({
    x: sunToSky.x * sunDistance,
    y: sunToSky.y * sunDistance,
    z: Math.max(sunToSky.z * sunDistance, 0.5),
  })
  // Keep sign convention aligned with shading geometry in utils/solar3d.
  const groundTiltRad = -props.groundTiltDeg * DEG_TO_RAD
  // Tilt axis in ENU: perpendicular to tilt direction (0=South, +90=West, -90=East)
  const tiltAxisENU = compassDirectionENU((props.groundTiltAzimuthDeg ?? 0) + 90)
  // Map ENU axis to Three.js space: enuToThree([x,y,0]) = [x, 0, -y]
  const tiltAxisThree = new THREE.Vector3(tiltAxisENU.x, 0, -tiltAxisENU.y)
  const groundQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxisThree, groundTiltRad)

  const orbitRef = useRef<OrbitControlsImpl | null>(null)
  const cameraHandle = useRef<CameraHandle | null>(null)

  return (
    <Box>
      <Group justify="space-between" align="center" mb={8}>
        <Text size="sm" c="dimmed">
          3D preview — real sun shadows, orbit camera
        </Text>
        <Group gap={6}>
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => cameraHandle.current?.top()}>
            Top
          </Button>
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => cameraHandle.current?.side()}>
            Side
          </Button>
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => cameraHandle.current?.orbit()}>
            Reset
          </Button>
        </Group>
      </Group>
      <div className="scene3d-shell" role="img" aria-label="Solar panel 3D field preview">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [10, 6.5, 10], fov: 42 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.4
          }}
        >
          <color attach="background" args={['#1d2a3d']} />
          <hemisphereLight intensity={0.82} color="#dde9ff" groundColor="#5c6d59" />
          <ambientLight intensity={0.58} />

          <directionalLight
            castShadow
            intensity={props.metrics.sunAboveHorizon ? 2.2 : 0.08}
            color="#ffe2a7"
            position={sunPosition}
            shadow-mapSize-width={4096}
            shadow-mapSize-height={4096}
            shadow-bias={-0.00002}
            shadow-normalBias={0.00025}
          >
            <object3D attach="target" position={[0, 0, 0]} />
            <orthographicCamera attach="shadow-camera" args={[-24, 24, 24, -24, 0.1, 120]} />
          </directionalLight>

          <directionalLight intensity={0.5} color="#a7c3f4" position={[-8, 9, -10]} />

          <SunSphere
            solarAzimuthDeg={props.metrics.solarAzimuthDeg}
            solarAltitudeDeg={props.metrics.solarAltitudeDeg}
            sunAboveHorizon={props.metrics.sunAboveHorizon}
          />

          <group quaternion={groundQuat}>
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
              <planeGeometry args={[60, 60]} />
              <meshStandardMaterial color="#3b5344" roughness={0.94} metalness={0.02} />
            </mesh>

            <CompassLabels />
            <PanelRows {...props} />
          </group>

          <CameraControls ref={cameraHandle} controlsRef={orbitRef} />

          <OrbitControls
            ref={orbitRef}
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={4}
            maxDistance={36}
            maxPolarAngle={Math.PI * 0.49}
          />
        </Canvas>
      </div>
      {!props.metrics.sunAboveHorizon ? (
        <Text mt={8} size="sm" c="dimmed">
          Sun is below horizon at selected time.
        </Text>
      ) : null}
    </Box>
  )
}
