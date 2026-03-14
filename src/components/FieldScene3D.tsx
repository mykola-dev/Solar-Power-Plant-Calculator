import { Box, Button, Group, Text } from '@mantine/core'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Text as DreiText, Line } from '@react-three/drei'
import React, { useRef, useImperativeHandle, forwardRef, useMemo, useLayoutEffect } from 'react'
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
  panelGapM: number
  windAzimuthDeg: number
  windSpeedMs: number
  mountHeightM: number
}

type CameraHandle = {
  top: () => void
  side: () => void
  orbit: () => void
}

const DEG_TO_RAD = Math.PI / 180

// Compass labels. enuToThree = [enu.x, enu.z, -enu.y], det=+1 (right-handed).
// ENU north(+Y) → Three -Z; ENU south(-Y) → Three +Z; ENU east(+X) → Three +X
const CompassLabels = React.memo(() => (
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
))
CompassLabels.displayName = 'CompassLabels'

const FieldBoundary = React.memo(({
  rowsCount,
  panelsPerRow,
  rowPitchM,
  panelWidthAcrossRowM,
  metrics,
  panelAzimuthDeg,
  panelGapM,
}: FieldScene3DProps) => {
  const singlePanelWidthM = Math.max(panelWidthAcrossRowM, 0.25)
  const rowLengthM = Math.max(panelsPerRow, 1) * singlePanelWidthM + Math.max(panelsPerRow - 1, 0) * panelGapM
  const effectivePitchM = Math.max(rowPitchM, 0.1)
  const fieldDepthM = (rowsCount - 1) * effectivePitchM + metrics.panelRunM
  const azimuthRad = panelAzimuthDeg * DEG_TO_RAD

  const halfW = rowLengthM / 2
  const margin = 0.15
  const yLift = 0.05

  const points = useMemo<[number, number, number][]>(() => {
    if (rowsCount <= 0 || panelsPerRow <= 0) return []
    return [
      [-halfW - margin, yLift, margin],
      [halfW + margin, yLift, margin],
      [halfW + margin, yLift, -fieldDepthM - margin],
      [-halfW - margin, yLift, -fieldDepthM - margin],
      [-halfW - margin, yLift, margin]
    ]
  }, [rowsCount, panelsPerRow, halfW, yLift, margin, fieldDepthM])

  if (rowsCount <= 0 || panelsPerRow <= 0) return null

  const widthText = `${rowLengthM.toFixed(2)} m`
  const lengthText = `${fieldDepthM.toFixed(2)} m`

  return (
    <group rotation={[0, Math.PI - azimuthRad, 0]}>
      <Line
        points={points}
        color="#a5d3f5"
        lineWidth={3}
        dashed={true}
        dashSize={0.5}
        dashScale={2}
        gapSize={0.2}
      />

      <DreiText
        position={[0, yLift + 0.1, margin + 0.4]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.6}
        color="#a5d3f5"
        anchorX="center"
        anchorY="middle"
      >
        {widthText}
      </DreiText>

      <DreiText
        position={[halfW + margin + 0.4, yLift + 0.1, -fieldDepthM / 2]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        fontSize={0.6}
        color="#a5d3f5"
        anchorX="center"
        anchorY="middle"
      >
        {lengthText}
      </DreiText>
    </group>
  )
})
FieldBoundary.displayName = 'FieldBoundary'

const PanelRows = React.memo(({
  rowsCount,
  panelsPerRow,
  rowPitchM,
  panelWidthAcrossRowM,
  metrics,
  panelAzimuthDeg,
  rowShadingFractions,
  panelGapM,
  mountHeightM,
}: FieldScene3DProps) => {
  const panelLengthM = Math.hypot(metrics.panelRunM, metrics.panelTopHeightM)
  const singlePanelWidthM = Math.max(panelWidthAcrossRowM, 0.25)
  const rowLengthM = Math.max(panelsPerRow, 1) * singlePanelWidthM + Math.max(panelsPerRow - 1, 0) * panelGapM
  const face = compassDirectionENU(panelAzimuthDeg)
  const effectivePitchM = Math.max(rowPitchM, 0.1)
  const panelTiltRad = Math.atan2(metrics.panelTopHeightM, Math.max(metrics.panelRunM, 0.01))
  const halfThickness = 0.018
  const azimuthRad = panelAzimuthDeg * DEG_TO_RAD

  const totalInstances = rowsCount * panelsPerRow
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const { geometry, material } = useMemo(() => {
    const geo = new THREE.BoxGeometry(singlePanelWidthM, halfThickness, panelLengthM)
    // Shift geometry so pivot (0,0,0) is at the front-bottom edge (bottom center of the south face)
    geo.translate(0, halfThickness / 2, -panelLengthM / 2)
    return {
      geometry: geo,
      material: new THREE.MeshStandardMaterial({ roughness: 0.33, metalness: 0.14 })
    }
  }, [singlePanelWidthM, panelLengthM, halfThickness])

  useLayoutEffect(() => {
    if (!meshRef.current) return

    const dummy = new THREE.Object3D()
    const colorObj = new THREE.Color()
    let idx = 0

    for (let rowIndex = 0; rowIndex < rowsCount; rowIndex++) {
      const enuBaseX = -face.x * effectivePitchM * rowIndex
      const enuBaseY = -face.y * effectivePitchM * rowIndex
      const threeX = enuBaseX
      const threeZ = -enuBaseY

      const shading = rowShadingFractions[rowIndex] ?? 0
      const colorText = shading > 0.65 ? '#4f7da8' : shading > 0.2 ? '#5a8fbc' : '#73afe6'
      colorObj.set(colorText)

      for (let panelIndex = 0; panelIndex < panelsPerRow; panelIndex++) {
        const xStart = -rowLengthM / 2 + singlePanelWidthM / 2
        const xOffset = xStart + panelIndex * (singlePanelWidthM + panelGapM)

        // Reset dummy
        dummy.position.set(threeX, mountHeightM, threeZ)
        dummy.rotation.set(0, Math.PI - azimuthRad, 0)
        dummy.updateMatrix()

        // Apply panel-specific local transform (tilt and offset)
        const panelMatrix = new THREE.Matrix4()
        panelMatrix.makeRotationX(panelTiltRad)
        panelMatrix.setPosition(xOffset, 0, 0)

        dummy.matrix.multiply(panelMatrix)
        meshRef.current.setMatrixAt(idx, dummy.matrix)
        meshRef.current.setColorAt(idx, colorObj)
        idx++
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [
    rowsCount,
    panelsPerRow,
    rowPitchM,
    panelWidthAcrossRowM,
    metrics.panelRunM,
    metrics.panelTopHeightM,
    panelAzimuthDeg,
    rowShadingFractions,
    panelGapM,
    azimuthRad,
    face.x,
    face.y,
    panelLengthM,
    panelTiltRad,
    rowLengthM,
    singlePanelWidthM,
    effectivePitchM,
    mountHeightM,
  ])

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, totalInstances]}
      castShadow
      receiveShadow
    />
  )
})
PanelRows.displayName = 'PanelRows'

const SunSphere = React.memo(({
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
      <mesh>
        <sphereGeometry args={[2.6, 24, 24]} />
        <meshBasicMaterial color="#ffe566" />
      </mesh>
      <mesh>
        <sphereGeometry args={[3.8, 16, 16]} />
        <meshBasicMaterial color="#ffdd33" transparent opacity={0.13} depthWrite={false} />
      </mesh>
    </group>
  )
})
SunSphere.displayName = 'SunSphere'

const WindArrow = React.memo(({ azimuthDeg, speedMs }: { azimuthDeg: number; speedMs: number }) => {
  if (speedMs <= 0) return null

  // Wind direction ENU: 0=North (+Y), 180=South (-Y)
  const dirENU = compassDirectionENU(azimuthDeg)
  // Arrow points in direction wind is blowing.
  const posDistance = 15 // Closer
  const posThree = enuToThree({
    x: -dirENU.x * posDistance,
    y: -dirENU.y * posDistance,
    z: 7 // Lower
  })

  const azimuthRad = azimuthDeg * DEG_TO_RAD

  return (
    <group position={posThree} rotation={[0, Math.PI - azimuthRad, 0]}>
      {/* Shaft */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 2]}>
        <cylinderGeometry args={[0.25, 0.25, 8, 8]} />
        <meshStandardMaterial color="#74c0fc" emissive="#74c0fc" emissiveIntensity={0.5} transparent opacity={0.8} />
      </mesh>
      {/* Head */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 6.5]}>
        <coneGeometry args={[0.9, 2.5, 12]} />
        <meshStandardMaterial color="#74c0fc" emissive="#74c0fc" emissiveIntensity={0.8} />
      </mesh>
      <DreiText
        position={[0, 1.8, 2]}
        fontSize={1.4}
        color="#74c0fc"
        rotation={[-Math.PI / 3, 0, 0]} // Tilt toward viewer
        anchorX="center"
        anchorY="middle"
      >
        Wind {speedMs} m/s
      </DreiText>
    </group>
  )
})
WindArrow.displayName = 'WindArrow'

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
  const sunPosition = useMemo(() => enuToThree({
    x: sunToSky.x * sunDistance,
    y: sunToSky.y * sunDistance,
    z: Math.max(sunToSky.z * sunDistance, 0.5),
  }), [sunToSky.x, sunToSky.y, sunToSky.z])

  const groundQuat = useMemo(() => {
    const groundTiltRad = -props.groundTiltDeg * DEG_TO_RAD
    const tiltAxisENU = compassDirectionENU((props.groundTiltAzimuthDeg ?? 0) + 90)
    const tiltAxisThree = new THREE.Vector3(tiltAxisENU.x, 0, -tiltAxisENU.y)
    return new THREE.Quaternion().setFromAxisAngle(tiltAxisThree, groundTiltRad)
  }, [props.groundTiltDeg, props.groundTiltAzimuthDeg])

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
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.00005}
            shadow-normalBias={0.0002}
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
            <FieldBoundary {...props} />
            <PanelRows {...props} />
          </group>

          <WindArrow azimuthDeg={props.windAzimuthDeg} speedMs={props.windSpeedMs} />

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

